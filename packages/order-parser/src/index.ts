import OpenAI from "openai";
import {
  ContentFilterFinishReasonError,
  LengthFinishReasonError,
} from "openai/core/error";
import { zodResponseFormat } from "openai/helpers/zod";
import { z as zod } from "zod";
import { deliveryDate } from "./dates.ts";
import { normalize, normalizeEmail } from "./normalize.ts";
import { type OrderReply, orderSchema, systemPrompt } from "./schema.ts";

type Model = {
  baseURL: string;
  model: string;
  apiKey: string;
  fetch?: typeof fetch;
};
type Field<Value> = {
  value: Value | null;
  excerpt: string | null;
  uncertain: boolean;
};
type ParseResult =
  | { status: "no_model" }
  | {
      status: "failed";
      reason:
        | "too_large"
        | "model_error"
        | "invalid_reply"
        | "refused"
        | "truncated"
        | "filtered";
    }
  | (Omit<OrderReply, "meals"> & {
      status: "parsed";
      meals: (OrderReply["meals"][number] & { source_index: number })[];
      dropped: string[];
      uncertain: string[];
    });
const folded = (value: string) => normalize(value).toLowerCase();

function occurrences(text: string, part: string): number[] {
  const starts: number[] = [];
  for (let at = text.indexOf(part); at >= 0; at = text.indexOf(part, at + 1))
    starts.push(at);
  return starts;
}

// A date excerpt cut mid-token ("5 Nov" from "15 Nov") would change its value.
function wholeTokens(text: string, excerpt: string): boolean {
  const joined = /[\p{L}\p{N}_/\p{Pd}]/u;
  return occurrences(text, excerpt).some(
    (start) =>
      !joined.test(text[start - 1] ?? "") &&
      !joined.test(text[start + excerpt.length] ?? ""),
  );
}

// Boundaries are read from the email line, not the excerpt, so a cut excerpt
// cannot turn "20" into "2"; ranges, fractions and grouped digits do not count.
function standaloneQuantity(
  line: string,
  excerpt: string,
  quantity: number,
  mealName: string,
): boolean {
  const digits = String(quantity);
  if (!/^\d+$/.test(digits)) return false;
  const number = new RegExp(
    `(?<![\\p{L}\\p{N}_.+\\p{Pd}])(?<!\\p{N}[,/])${digits}(?![\\p{L}\\p{N}_+\\p{Pd}]|[.,/]\\p{N})`,
    "gu",
  );
  const names = occurrences(line, mealName);
  return occurrences(line, excerpt).some((start) =>
    [...line.matchAll(number)].some((match) => {
      const end = match.index + digits.length;
      const insideName = names.some(
        (name) => match.index < name + mealName.length && end > name,
      );
      return (
        match.index >= start && end <= start + excerpt.length && !insideName
      );
    }),
  );
}

function checkEvidence(
  reply: OrderReply,
  text: string,
  receivedOn?: string,
): ParseResult {
  const dropped: string[] = [];
  const uncertain: string[] = [];
  const source = folded(text);
  function check<Value>(
    field: Field<Value>,
    path: string,
    valid: (excerpt: string) => boolean,
  ): Field<Value> {
    if (field.value === null)
      return { value: null, excerpt: null, uncertain: false };
    const excerpt = field.excerpt === null ? "" : folded(field.excerpt);
    if (!excerpt || !source.includes(excerpt) || !valid(excerpt)) {
      dropped.push(path);
      return { value: null, excerpt: null, uncertain: false };
    }
    if (field.uncertain) uncertain.push(path);
    return field;
  }
  const textual = (field: Field<string>, path: string) =>
    check(
      field,
      path,
      (excerpt) =>
        field.value !== null &&
        Boolean(field.value.trim()) &&
        excerpt.includes(folded(field.value)),
    );
  const service = textual(reply.service, "service");
  const kind = check(reply.kind, "kind", () => true);
  const date = reply.delivery_date.excerpt
    ? deliveryDate(normalize(reply.delivery_date.excerpt), receivedOn)
    : null;
  const delivery_date = check(
    {
      ...reply.delivery_date,
      uncertain: reply.delivery_date.uncertain || Boolean(date?.uncertain),
    },
    "delivery_date",
    (excerpt) =>
      date !== null &&
      date.value === reply.delivery_date.value &&
      wholeTokens(source, excerpt),
  );
  const meals = reply.meals.flatMap((meal, source_index) => {
    const path = `meals[${source_index}]`;
    const name = textual(meal.name, path);
    if (name.value === null) {
      // A meal reported without a name is still a reported item.
      if (
        meal.name.value === null &&
        [meal.chef.value, meal.quantity.value].some((value) => value !== null)
      )
        dropped.push(path);
      return [];
    }
    const mealName = folded(name.value);
    const chef = textual(meal.chef, `${path}.chef`);
    const quantity = check(meal.quantity, `${path}.quantity`, (excerpt) => {
      // A shared row cannot establish which meal owns the number.
      const otherMeal = reply.meals.some(
        (other, index) =>
          index !== source_index &&
          other.name.value?.trim() &&
          excerpt.includes(folded(other.name.value)),
      );
      const count = meal.quantity.value;
      return (
        count !== null &&
        !excerpt.includes("\n") &&
        excerpt.includes(mealName) &&
        !otherMeal &&
        source
          .split("\n")
          .some((line) => standaloneQuantity(line, excerpt, count, mealName))
      );
    });
    return [{ name, chef, quantity, source_index }];
  });
  return {
    status: "parsed",
    service,
    delivery_date,
    kind,
    meals,
    dropped,
    uncertain,
  };
}

export async function parseOrderEmail(
  email: { subject: string; text?: string; html?: string },
  model: Model | null,
  options: { received_on?: string } = {},
): Promise<ParseResult> {
  if (model === null) return { status: "no_model" };
  let text: string | null;
  try {
    text = normalizeEmail(email);
  } catch (error) {
    // html-to-text recurses per element, so deep nesting overflows the stack.
    if (!(error instanceof RangeError)) throw error;
    text = null;
  }
  if (text === null) return { status: "failed", reason: "too_large" };
  try {
    const transport = model.fetch ?? globalThis.fetch;
    const client = new OpenAI({
      baseURL: model.baseURL,
      apiKey: model.apiKey,
      organization: null,
      project: null,
      logLevel: "off",
      timeout: 30_000,
      maxRetries: 1,
      fetch: async (input, init) => {
        const sent = new Headers(
          input instanceof Request ? input.headers : undefined,
        );
        new Headers(init?.headers).forEach((value, name) =>
          sent.set(name, value),
        );
        // An allow list, because the SDK merges OPENAI_CUSTOM_HEADERS from the environment.
        const headers = new Headers({
          Authorization: `Bearer ${model.apiKey}`,
        });
        for (const name of ["Accept", "Content-Type"]) {
          const value = sent.get(name);
          if (value !== null) headers.set(name, value);
        }
        return transport(input, { ...init, headers });
      },
    });
    const response = await client.chat.completions.parse({
      model: model.model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            received_on: options.received_on ?? null,
            email: text,
          }),
        },
      ],
      response_format: zodResponseFormat(orderSchema, "order_email"),
    });
    const message = response.choices[0]?.message;
    if (message?.refusal || !message?.parsed)
      return { status: "failed", reason: "refused" };
    return checkEvidence(message.parsed, text, options.received_on);
  } catch (error) {
    const reason =
      error instanceof LengthFinishReasonError
        ? "truncated"
        : error instanceof ContentFilterFinishReasonError
          ? "filtered"
          : error instanceof SyntaxError || error instanceof zod.ZodError
            ? "invalid_reply"
            : "model_error";
    return { status: "failed", reason };
  }
}
