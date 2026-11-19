import { createHash, randomUUID } from "node:crypto";
import {
  fromStoredNutrition,
  type ServingBasis,
  servingsFor,
} from "@tare/nutrition";
import { z as zod } from "zod";
import type { Person } from "../auth/middleware.ts";
import { ledgerTotals, ledgerTotalsSchema } from "../days/ledger.ts";
import { scopeDatabase, type WriteScope, writeTransaction } from "../db.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { insertMealReceipt } from "../queries/insert-meal-receipt.ts";
import {
  type SelectIntakeByClientResult,
  selectIntakeByClient,
} from "../queries/select-intake-by-client.ts";
import { selectMealReceipt } from "../queries/select-meal-receipt.ts";
import {
  type Clock,
  insertIntake,
  mealPartClientId,
  type Reference,
  readReferenceFood,
} from "./intake.ts";
import { resolveProvenance } from "./provenance.ts";
import { intakeRow, nutrientKeys } from "./schemas.ts";

const foodId = zod.number().int().positive();
const grams = zod.number().positive();
const amounts = {
  grams,
  grams_low: grams.optional(),
  grams_high: grams.optional(),
};
const mealPart = zod
  .union([
    zod.strictObject({ food_id: foodId, ...amounts }),
    zod.strictObject({ source_food_id: foodId, ...amounts }),
  ])
  .refine(
    ({ grams, grams_low, grams_high }) =>
      (grams_low === undefined && grams_high === undefined) ||
      (grams_low !== undefined &&
        grams_high !== undefined &&
        grams_low <= grams &&
        grams <= grams_high),
  );

const mealInput = zod.strictObject({
  client_id: zod.string().min(1).max(100),
  eaten_at: zod.string().optional(),
  meal_note: zod.string().max(200).optional(),
  parts: zod.array(mealPart).min(1).max(12),
});
const mealOutput = zod.strictObject({
  entries: zod.array(intakeRow),
  totals: ledgerTotalsSchema,
  kcal_range: zod
    .strictObject({ low: zod.number(), high: zod.number() })
    .nullable(),
});

type PartError =
  | "food_not_found"
  | "no_serving_basis"
  | "dimension_mismatch"
  | "amount_out_of_range"
  | "invalid_part";

function partError(code: PartError, part: number) {
  return new OperationError(
    code === "food_not_found" ? 404 : 400,
    code,
    {},
    undefined,
    part,
  );
}

function gramsToServings(amount: number, basis: ServingBasis, part: number) {
  const converted = servingsFor(amount, "g", basis);
  if (converted.ok) return converted.value;
  throw partError(
    converted.reason === "dimension_mismatch"
      ? converted.reason
      : "amount_out_of_range",
    part,
  );
}

function writePart(
  scope: WriteScope,
  person: Person,
  clock: Clock,
  input: zod.infer<typeof mealInput>,
  part: zod.infer<typeof mealPart>,
  partNumber: number,
  partKey: string,
) {
  const reference: Reference =
    "food_id" in part
      ? { kind: "food", id: part.food_id }
      : { kind: "source_food", id: part.source_food_id };
  const food = readReferenceFood(scope, person, reference);
  if (!food) throw partError("food_not_found", partNumber);
  if ((food.serving_size === null) !== (food.serving_unit === null))
    throw partError("no_serving_basis", partNumber);
  const { basis } = fromStoredNutrition({
    ...food,
    provenance: resolveProvenance({}, food),
  });
  if (!basis?.unit.trim()) throw partError("no_serving_basis", partNumber);

  const { grams, grams_low, grams_high } = part;
  const servings = gramsToServings(grams, basis, partNumber);
  const estimatedRange =
    grams_low === undefined || grams_high === undefined
      ? null
      : {
          low: gramsToServings(grams_low, basis, partNumber),
          high: gramsToServings(grams_high, basis, partNumber),
        };
  const estimate =
    estimatedRange === null
      ? `Estimated ${grams} g`
      : `Estimated ${grams} g (${grams_low} to ${grams_high} g)`;
  try {
    const result = insertIntake(
      scope,
      person,
      {
        reference,
        servings,
        estimatedRange,
        claim: {},
        client_id: mealPartClientId(partKey, partNumber),
        eaten_at: input.eaten_at,
        portion_note: input.meal_note
          ? `${estimate}. ${input.meal_note}`
          : estimate,
      },
      clock,
      "suppress",
      food,
    );
    if (!result.created) throw new OperationError(409, "mutation_conflict");
    return result.entry;
  } catch (error) {
    if (error instanceof OperationError && error.code === "invalid_request")
      throw partError("amount_out_of_range", partNumber);
    throw error;
  }
}

function finiteAmount(amount: number, part: number) {
  if (!Number.isFinite(amount)) throw partError("amount_out_of_range", part);
}

function mealSummary(entries: SelectIntakeByClientResult[]) {
  const bounds = entries.map((entry, index) => {
    for (const key of nutrientKeys) {
      const value = entry[key];
      if (value !== null) finiteAmount(value, index + 1);
    }
    return entry.kcal_low === null || entry.kcal_high === null
      ? null
      : { low: entry.kcal_low, high: entry.kcal_high };
  });
  const totals = ledgerTotals(entries, finiteAmount);
  let kcal_range = null;
  if (bounds.every((range) => range !== null)) {
    kcal_range = { low: 0, high: 0 };
    for (const [index, range] of bounds.entries()) {
      kcal_range.low += range.low;
      kcal_range.high += range.high;
      finiteAmount(kcal_range.low, index + 1);
      finiteAmount(kcal_range.high, index + 1);
    }
  }
  return { entries, totals, kcal_range };
}

export const logMealParts = defineOperation({
  name: "log_meal_parts",
  description:
    "Get food IDs first with search_food_candidates and add_source_food, or with find_food. Each part needs grams and one food_id or source_food_id. For a range, send both grams_low and grams_high.",
  method: "POST",
  path: "/api/intake/meal-parts",
  modes: ["access", "fallback"],
  callerClass: "browser_and_agent",
  admin: false,
  bodyLimit: 8192,
  input: mealInput,
  mcpInput: mealInput.extend({
    parts: zod.array(zod.unknown()).min(1).max(12),
  }),
  inputRejection(error) {
    const issue = error.issues.find(
      ({ path }) => path[0] === "parts" && typeof path[1] === "number",
    );
    const index = issue?.path[1];
    return typeof index === "number"
      ? partError("invalid_part", index + 1)
      : undefined;
  },
  output: mealOutput,
  handler(input, context) {
    const person = operationPerson(context);
    const request_hash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    return writeTransaction(context.database, (scope) => {
      const database = scopeDatabase(scope);
      const key = { user_id: person.id, client_id: input.client_id };
      const receipt = selectMealReceipt(database, key);
      if (receipt) {
        if (receipt.request_hash !== request_hash)
          throw new OperationError(409, "mutation_conflict");
        const entries = Array.from(
          { length: receipt.part_count },
          (_, index) => {
            const entry = selectIntakeByClient(database, {
              user_id: person.id,
              client_id: mealPartClientId(receipt.part_key, index + 1),
            });
            if (!entry) throw new OperationError(409, "meal_part_deleted");
            return entry;
          },
        );
        return { status: 200, body: mealSummary(entries) };
      }

      const now = context.clock.now();
      const part_key = randomUUID();
      const receiptInsert = insertMealReceipt(database, {
        ...key,
        part_key,
        request_hash,
        part_count: input.parts.length,
        created_at: now.toISOString(),
      });
      if (receiptInsert.changes !== 1)
        throw new Error("Meal receipt was not inserted");
      const clock = { now: () => now };
      const entries = input.parts.map((part, index) =>
        writePart(scope, person, clock, input, part, index + 1, part_key),
      );
      return { status: 201, body: mealSummary(entries) };
    });
  },
});
