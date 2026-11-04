import { foldName } from "@tare/nutrition";
import { z as zod } from "zod";
import type { Person } from "../auth/middleware.ts";
import type { Config } from "../config.ts";
import { scopeDatabase, type WriteScope } from "../db.ts";
import { localDay } from "../logging/day.ts";
import { askMealNutrition, mealKey } from "../meal-nutrition/index.ts";
import { OperationError } from "../operations/registry.ts";
import { createOrder, isDue, updateMeal } from "../orders/index.ts";
import { deleteExpectedMeal } from "../queries/orders/delete-expected-meal.ts";
import { insertOrderMeal } from "../queries/orders/insert-order-meal.ts";
import { listReconcileMeals } from "../queries/orders/list-reconcile-meals.ts";
import { selectDeliveryOrder } from "../queries/orders/select-delivery-order.ts";
import { selectNextOrder } from "../queries/orders/select-next-order.ts";
import { selectOrder } from "../queries/orders/select-order.ts";
import { updateOrderSource } from "../queries/orders/update-order-source.ts";
import { selectOpenOrderQuestion } from "../queries/select-open-order-question.ts";
import { selectReconcileEmail } from "../queries/select-reconcile-email.ts";
import { updateEmailReconciliation } from "../queries/update-email-reconciliation.ts";
import {
  type ApplyOutcome,
  createQuestion,
  type QuestionKind,
} from "../questions/kinds.ts";
import {
  advisoryAnswer,
  corrections,
  dateAnswer,
  lateAnswer,
  normalizedOrder,
  readOrderDraft,
} from "./reconcile-input.ts";

export type ReconcileContext = {
  questionKinds: ReadonlyMap<string, QuestionKind>;
  services: Config["orderEmailServices"];
  answer?: { id: number; advisory?: boolean; acceptNew?: boolean };
};
const applied: ApplyOutcome = { status: "applied" };
const superseded: ApplyOutcome = { status: "superseded" };

export function reconcileEmail(
  scope: WriteScope,
  identity: { id: number; user_id: number },
  person: Person,
  now: string,
  context: ReconcileContext,
  mode: "job" | "fromAnswer",
): ApplyOutcome {
  const database = scopeDatabase(scope);
  if (identity.user_id !== person.id) throw new Error("Email owner mismatch");
  const email = selectReconcileEmail(database, identity);
  if (!email) throw new OperationError(404, "not_found");
  if (
    mode === "job" &&
    (email.disposition !== null || email.parse_state !== "parsed")
  )
    return applied;
  if (email.disposition === "discarded")
    throw new OperationError(409, "email_discarded");
  const input = readOrderDraft(email);
  if (email.service !== null) input.service = email.service;
  const save = (
    disposition: "questioned" | "reconciled",
    orderId = email.applied_order_id,
    manual = email.manual_result,
  ) => {
    const updated = updateEmailReconciliation(
      database,
      { disposition, now, manual_result: manual, applied_order_id: orderId },
      identity,
    );
    if (updated.changes !== 1) throw new Error("Email update failed");
  };
  const ask = (
    kind: string,
    prompt: string,
    schema: zod.ZodType,
    metadata: Record<string, unknown> = {},
  ) => {
    const reviewMode = typeof metadata.mode === "string" ? metadata.mode : null;
    if (
      !selectOpenOrderQuestion(database, {
        user_id: person.id,
        subject_ref: String(email.id),
        kind,
        mode: reviewMode,
        excluded_id: context.answer?.id ?? -1,
      })
    ) {
      createQuestion(
        database,
        {
          userId: person.id,
          subjectRef: String(email.id),
          kind,
          prompt,
          answerSchema: {
            ...zod.toJSONSchema(schema, { target: "draft-7", io: "input" }),
            ...metadata,
          },
        },
        { now: () => new Date(now) },
        context.questionKinds,
      );
    }
  };
  const block = (fields: string[]) => {
    save(
      "questioned",
      email.applied_order_id,
      JSON.stringify({ partial: input }),
    );
    ask(
      "order_review",
      `Complete order details: ${fields.join(", ")}.`,
      corrections,
      { mode: "blocking", fields },
    );
    return applied;
  };
  const targets = ["service", "kind", "delivery_date"].filter(
    (field) =>
      !(field === "service" && email.service !== null) &&
      (input.issues.includes(field) ||
        (field !== "delivery_date" &&
          input[field as "service" | "kind"] === null)),
  );
  if (
    input.delivery_date !== null &&
    !zod.iso.date().safeParse(input.delivery_date).success &&
    !targets.includes("delivery_date")
  )
    targets.push("delivery_date");
  if (targets.length) return block(targets);
  const service = zod.string().parse(input.service);
  let order =
    context.answer?.advisory && email.applied_order_id !== null
      ? selectOrder(database, {
          user_id: person.id,
          id: email.applied_order_id,
        })
      : input.delivery_date === null
        ? input.kind === "processed"
          ? selectNextOrder(database, {
              user_id: person.id,
              service,
              received_on: localDay(
                email.created_at,
                person.timezone,
                person.day_start_hour,
              ),
            })
          : null
        : selectDeliveryOrder(database, {
            user_id: person.id,
            service,
            delivery_date: input.delivery_date,
          });
  const existing = order
    ? listReconcileMeals(database, { user_id: person.id, order_id: order.id })
    : [];
  // A changed day boundary must not make consumed stock replaceable.
  const protectedStock = existing.some((meal) => meal.has_consumption);
  const due = order
    ? isDue(order, person, now) || protectedStock
    : input.delivery_date !== null &&
      isDue(
        { delivered_at: null, delivery_date: input.delivery_date },
        person,
        now,
      );
  const late = (manual: string) => {
    save("questioned", email.applied_order_id, manual);
    const target = order
      ? { type: "existing", id: order.id }
      : { type: "new", service, delivery_date: input.delivery_date };
    ask(
      "order_late_list",
      "Review the late order list.",
      order ? lateAnswer.extend({ action: zod.literal("ignore") }) : lateAnswer,
      { target },
    );
    return applied;
  };
  if (context.answer?.advisory) {
    if (!order || order.applied_email_id !== email.id) {
      save(
        "reconciled",
        email.applied_order_id,
        JSON.stringify(normalizedOrder(input)),
      );
      return superseded;
    }
    if (due) throw new OperationError(409, "order_due");
  }
  if (input.delivery_date === null && !order) {
    save(
      "questioned",
      email.applied_order_id,
      JSON.stringify({ partial: input }),
    );
    ask("order_delivery_date", "Enter the delivery date.", dateAnswer);
    return applied;
  }
  if (order && due) {
    if (!context.answer?.acceptNew)
      return late(JSON.stringify({ partial: input }));
    save("reconciled", null);
    return superseded;
  }
  const missing = input.meals.length === 0 ? ["meals"] : [];
  for (const meal of input.meals) {
    const path = `meals[${meal.source_index}]`;
    if (meal.quantity === null || input.issues.includes(`${path}.quantity`))
      missing.push(`${path}.quantity`);
    if (meal.chef === null && !input.resolved.includes(`${path}.chef`)) {
      const matches = existing.filter(
        (candidate) => foldName(candidate.name) === foldName(meal.name),
      );
      const chefs = new Map(
        matches.map((candidate) => [
          foldName(candidate.chef ?? ""),
          candidate.chef,
        ]),
      );
      if (chefs.size > 1) missing.push(`${path}.chef`);
      else if (chefs.size === 1) meal.chef = [...chefs.values()][0] ?? null;
    }
  }
  if (missing.length) return block(missing);
  const normalized = normalizedOrder(input);
  const manual = JSON.stringify(normalized);
  const date =
    order?.delivery_date ?? zod.string().parse(normalized.delivery_date);
  if (!context.answer?.acceptNew && due) return late(manual);
  if (context.answer?.acceptNew) {
    try {
      order = createOrder(
        scope,
        person,
        {
          service,
          delivery_date: date,
          status: normalized.kind === "scheduling" ? "scheduled" : "processed",
          meals: [],
        },
        context.questionKinds,
        now,
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "SQLITE_CONSTRAINT_UNIQUE"
      )
        throw error;
      order = selectDeliveryOrder(database, {
        user_id: person.id,
        service,
        delivery_date: date,
      });
      if (!order) throw error;
      if (
        isDue(order, person, now) ||
        listReconcileMeals(database, {
          user_id: person.id,
          order_id: order.id,
        }).some((meal) => meal.has_actions)
      ) {
        save("reconciled", null, manual);
        return superseded;
      }
    }
  }
  if (order) {
    const prior =
      order.applied_email_id === null
        ? null
        : selectReconcileEmail(database, {
            user_id: person.id,
            id: order.applied_email_id,
          });
    const loses =
      (order.status === "processed" && normalized.kind === "scheduling") ||
      (order.status ===
        (normalized.kind === "scheduling" ? "scheduled" : "processed") &&
        prior !== null &&
        (prior.created_at > email.created_at ||
          (prior.created_at === email.created_at && prior.id > email.id)));
    if (loses) {
      save("reconciled", null, manual);
      return context.answer?.acceptNew ? superseded : applied;
    }
  } else
    order = createOrder(
      scope,
      person,
      {
        service,
        delivery_date: date,
        status: normalized.kind === "scheduling" ? "scheduled" : "processed",
        meals: [],
      },
      context.questionKinds,
      now,
    );
  const desired = new Map<string, (typeof normalized.meals)[number]>();
  for (const meal of normalized.meals) {
    const key = mealKey({ ...meal, service });
    const previous = desired.get(key);
    if (previous) previous.quantity += meal.quantity;
    else desired.set(key, { ...meal });
  }
  for (const meal of listReconcileMeals(database, {
    user_id: person.id,
    order_id: order.id,
  })) {
    const key = mealKey({ ...meal, service });
    const replacement = desired.get(key);
    if (replacement) {
      if (
        !context.answer?.advisory ||
        meal.name !== replacement.name ||
        meal.chef !== replacement.chef ||
        meal.quantity !== replacement.quantity
      )
        updateMeal(scope, person.id, meal.id, replacement, now);
      desired.delete(key);
    } else if (meal.has_actions)
      updateMeal(scope, person.id, meal.id, { quantity: 0 }, now);
    else if (
      deleteExpectedMeal(database, { user_id: person.id, id: meal.id })
        .changes !== 1
    )
      throw new Error("Meal delete failed");
  }
  for (const meal of desired.values()) {
    if (
      !insertOrderMeal(database, {
        ...meal,
        user_id: person.id,
        order_id: order.id,
        updated_at: now,
      })
    )
      throw new Error("Meal insert returned no row");
    askMealNutrition(
      database,
      person.id,
      { ...meal, service },
      now,
      context.questionKinds,
    );
  }
  if (
    updateOrderSource(
      database,
      {
        status: normalized.kind === "scheduling" ? "scheduled" : "processed",
        applied_email_id: email.id,
      },
      { user_id: person.id, id: order.id },
    ).changes !== 1
  )
    throw new Error("Order update failed");

  save("reconciled", order.id, manual);
  if (input.issues.length)
    ask(
      "order_review",
      `Check order details: ${input.issues.join(", ")}.`,
      advisoryAnswer,
      { mode: "advisory", fields: input.issues },
    );
  return applied;
}
