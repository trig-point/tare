import { createHash } from "node:crypto";
import { fromStoredNutrition, toStoredNutrition } from "@tare/nutrition";
import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import type { Person } from "../auth/middleware.ts";
import { scopeDatabase, type WriteScope, writeTransaction } from "../db.ts";
import { foodPartError, readWeighedFood } from "../logging/intake.ts";
import { resolveProvenance } from "../logging/provenance.ts";
import {
  type Numbers,
  numbersFrom,
  nutrientFields,
  validateNumbers,
} from "../logging/schemas.ts";
import {
  defineOperation,
  type OperationContext,
  OperationError,
  type OperationResult,
  operationPerson,
} from "../operations/registry.ts";
import { insertFood } from "../queries/insert-food.ts";
import { insertFoodReceipt } from "../queries/insert-food-receipt.ts";
import { selectFood } from "../queries/select-food.ts";
import { selectFoodReceipt } from "../queries/select-food-receipt.ts";
import { selectRegularMealFood } from "../queries/select-regular-meal-food.ts";
import { selectSourceFood } from "../queries/select-source-food.ts";

import { updateOwnedFood } from "../queries/update-owned-food.ts";

export type OwnedFoodValues = Numbers & {
  name: string;
  serving_size: number;
  serving_unit: string;
  provenance: "label" | "estimated";
  source: string | null;
  source_food_id: number | null;
};

function validateFood(values: OwnedFoodValues, sourceDatabase?: Database) {
  const name = values.name.trim();
  const unit = values.serving_unit.trim();
  const source = values.source?.trim() ?? null;
  if (!name || !unit || source === "")
    throw new OperationError(400, "invalid_request");
  const numbers = numbersFrom(values);
  validateNumbers(numbers);
  const provenance = resolveProvenance(
    { provenance: values.provenance, source },
    null,
  );
  if (sourceDatabase && values.source_food_id !== null) {
    const evidence = selectSourceFood(sourceDatabase, {
      id: values.source_food_id,
    });
    if (!evidence) throw new OperationError(404, "food_not_found");
    // Owned servings never convert units, so they must keep the source's basis.
    if (
      evidence.serving_size !== values.serving_size ||
      evidence.serving_unit !== unit
    )
      throw new OperationError(400, "serving_basis_mismatch");
  }
  const nutrition = toStoredNutrition(
    {
      source: "own",
      ...fromStoredNutrition({
        ...numbers,
        serving_size: values.serving_size,
        serving_unit: unit,
        provenance,
      }),
    },
    "food",
  );
  if (!nutrition.ok) throw new OperationError(400, "invalid_request");
  return { name, source, numbers, row: nutrition.row };
}

/** Every check insertOwnedFood makes, without writing; throws the same errors. */
export function checkOwnedFood(database: Database, values: OwnedFoodValues) {
  return validateFood(values, database);
}

/** Validates and inserts one owned food in the caller's transaction; callers keep their own replay records. */
export function insertOwnedFood(
  scope: WriteScope,
  userId: number,
  values: OwnedFoodValues,
) {
  const database = scopeDatabase(scope);
  const { name, source, numbers, row } = checkOwnedFood(database, values);
  const food = insertFood(database, {
    ...numbers,
    ...row,
    user_id: userId,
    name,
    source,
    source_food_id: values.source_food_id,
  });
  if (!food) throw new Error("Food insert returned no row");
  return food;
}

const text = zod.string().trim().min(1);
const { kcal, ...optionalNutrients } = nutrientFields;
export const ownedFoodInput = zod.strictObject({
  name: text,
  serving_size: zod.number().positive(),
  serving_unit: text,
  kcal,
  ...zod.object(optionalNutrients).partial().shape,
  provenance: zod.enum(["label", "estimated"]),
  source: text.nullable().optional(),
  source_food_id: zod.number().int().positive().nullable().optional(),
});
/** Every key in a fixed order, so the same food always serializes the same way. */
export const ownedFoodValues = (
  input: zod.output<typeof ownedFoodInput>,
): OwnedFoodValues => ({
  ...numbersFrom(input),
  name: input.name,
  serving_size: input.serving_size,
  serving_unit: input.serving_unit,
  provenance: input.provenance,
  source: input.source ?? null,
  source_food_id: input.source_food_id ?? null,
});
const foodView = zod.strictObject({
  id: zod.number().int().positive(),
  name: zod.string(),
  serving_size: zod.number().positive(),
  serving_unit: zod.string(),
  ...nutrientFields,
  provenance: zod.enum(["label", "estimated"]),
  source: zod.string().nullable(),
  source_food_id: zod.number().int().positive().nullable(),
});

const foodOutput = zod.strictObject({ food: foodView, created: zod.boolean() });

function viewOfFood(food: NonNullable<ReturnType<typeof selectFood>>) {
  const {
    user_id: _owner,
    service: _service,
    meal_name: _mealName,
    chef: _chef,
    meal_key: _mealKey,
    ...view
  } = food;
  return view;
}

function saveFoodOnce(
  context: OperationContext,
  userId: number,
  mutationId: string,
  requestHash: string,
  values: (scope: WriteScope) => OwnedFoodValues,
): OperationResult {
  return writeTransaction(context.database, (scope) => {
    const database = scopeDatabase(scope);
    const key = { user_id: userId, mutation_id: mutationId.toLowerCase() };
    const prior = selectFoodReceipt(database, key);
    if (prior && prior.request_hash !== requestHash)
      throw new OperationError(409, "mutation_conflict");
    const food = prior
      ? selectFood(database, { user_id: userId, id: prior.food_id })
      : insertOwnedFood(scope, userId, values(scope));
    if (!food) throw new Error("Receipted food not found");
    if (
      !prior &&
      !insertFoodReceipt(database, {
        ...key,
        request_hash: requestHash,
        food_id: food.id,
        created_at: context.clock.now().toISOString(),
      })
    )
      throw new Error("Food receipt was not inserted");
    return {
      status: prior ? 200 : 201,
      body: { food: viewOfFood(food), created: !prior },
    };
  });
}

const createFood = defineOperation({
  name: "create_food",
  description:
    "Create a food with confirmed nutrition for one serving. kcal is required; send null when unknown. Replaying a mutation_id returns the same food.",
  modes: ["access", "fallback"],
  callerClass: "browser_and_agent",
  admin: false,
  method: "POST",
  path: "/api/foods",
  bodyLimit: 8192,
  input: ownedFoodInput.extend({ mutation_id: zod.uuid() }),
  output: foodOutput,
  handler(input, context) {
    const userId = operationPerson(context).id;
    const values = ownedFoodValues(input);
    const requestHash = createHash("sha256")
      .update(JSON.stringify(values))
      .digest("hex");
    return saveFoodOnce(
      context,
      userId,
      input.mutation_id,
      requestHash,
      () => values,
    );
  },
});

const servingBasisCode = "serving_basis_not_editable";
const servingBasisIssue =
  "Serving size and unit can't change; create a new food instead.";
const servingBasisError = `${servingBasisCode}: ${servingBasisIssue}`;

const editFields = ownedFoodInput
  .omit({ source_food_id: true, serving_size: true, serving_unit: true })
  .partial();
const editFoodInput = zod
  .strictObject(
    {
      ...editFields.shape,
      id: zod.union([
        zod.number().int().positive(),
        zod.string().regex(/^0*[1-9][0-9]*$/),
      ]),
    },
    {
      error: (issue) =>
        issue.code === "unrecognized_keys" &&
        issue.keys.some(
          (key) => key === "serving_size" || key === "serving_unit",
        )
          ? servingBasisError
          : undefined,
    },
  )
  .refine((input) => Object.keys(input).length > 1)
  .meta({ minProperties: 2 });

const editFood = defineOperation({
  name: "edit_food",
  description:
    "Correct a saved food. Omitted fields keep their values. Create a new food for a different serving size or unit. Past logs keep their nutrition.",
  modes: ["access", "fallback"],
  callerClass: "browser_and_agent",
  admin: false,
  method: "PATCH",
  path: "/api/foods/:id",
  bodyLimit: 8192,
  input: editFoodInput,
  inputRejection: (error) =>
    error.issues.some((issue) => issue.message === servingBasisError)
      ? new OperationError(400, servingBasisCode, {}, [servingBasisIssue])
      : undefined,
  output: foodOutput,
  handler({ id, ...fields }, context) {
    const owner = { id: Number(id), user_id: operationPerson(context).id };
    if (!Number.isSafeInteger(owner.id))
      throw new OperationError(404, "food_not_found");
    return writeTransaction(context.database, (scope) => {
      const database = scopeDatabase(scope);
      const food = selectFood(database, owner);
      if (!food) throw new OperationError(404, "food_not_found");
      const regularMeal = selectRegularMealFood(database, owner);
      if (regularMeal)
        throw new OperationError(409, "food_is_regular_meal", {}, [
          regularMeal.archived_at === null
            ? "This food belongs to a regular meal; correct it with save_regular_meal."
            : "This food belongs to an archived regular meal and can't be edited.",
        ]);
      const { id: _id, ...stored } = viewOfFood(food);
      const merged = { ...stored, ...fields };
      const parsed = ownedFoodInput.safeParse(merged);
      if (!parsed.success) throw new OperationError(400, "invalid_request");
      const { name, source, numbers, row } = validateFood(
        ownedFoodValues(parsed.data),
      );
      const [updated] = updateOwnedFood(
        database,
        { ...numbers, provenance: row.provenance, name, source },
        owner,
      );
      if (!updated) throw new Error("Food update returned no row");
      return { status: 200, body: { food: updated, created: false } };
    });
  },
});

const foodId = zod.number().int().positive();
const batchGrams = zod.number().positive().max(100_000);
const batchInput = zod.strictObject({
  mutation_id: zod.uuid(),
  name: text,
  cooked_grams: batchGrams,
  ingredients: zod
    .array(
      zod.union([
        zod.strictObject({ food_id: foodId, grams: batchGrams }),
        zod.strictObject({ source_food_id: foodId, grams: batchGrams }),
      ]),
    )
    .min(1)
    .max(40),
});

const batchNutrients = [
  "kcal",
  "protein_g",
  "carbs_g",
  "fat_g",
  "fiber_g",
] as const;
type BatchNutrient = (typeof batchNutrients)[number];
type BatchTotal = { amount: number; part: number; complete: boolean };

function checkedBatchAmount(amount: number, positive: boolean, part: number) {
  if (!Number.isFinite(amount) || (positive && amount === 0))
    throw foodPartError("amount_out_of_range", part);
  return amount;
}

function batchValues(
  scope: WriteScope,
  person: Person,
  {
    name,
    cooked_grams,
    ingredients,
  }: Omit<zod.output<typeof batchInput>, "mutation_id">,
): OwnedFoodValues {
  const zero = { amount: 0, part: 1, complete: true };
  const totals: Record<BatchNutrient, BatchTotal> = {
    kcal: zero,
    protein_g: zero,
    carbs_g: zero,
    fat_g: zero,
    fiber_g: zero,
  };
  let provenance: OwnedFoodValues["provenance"] = "label";
  for (const [index, ingredient] of ingredients.entries()) {
    const part = index + 1;
    const weighed = readWeighedFood(scope, person, ingredient, part);
    if (weighed.food.kcal === null)
      throw foodPartError("ingredient_kcal_unknown", part);
    if (weighed.provenance === "estimated") provenance = "estimated";
    for (const key of batchNutrients) {
      const value = weighed.food[key];
      const total = totals[key];
      if (value === null) {
        totals[key] = { ...total, complete: false };
        continue;
      }
      const contribution = checkedBatchAmount(
        value * weighed.servings,
        value > 0,
        part,
      );
      if (contribution !== 0)
        totals[key] = {
          ...total,
          amount: checkedBatchAmount(total.amount + contribution, true, part),
          part,
        };
    }
  }

  const numbers = numbersFrom({});
  for (const key of batchNutrients) {
    const total = totals[key];
    if (total.complete)
      numbers[key] = checkedBatchAmount(
        (total.amount * 100) / cooked_grams,
        total.amount > 0,
        total.part,
      );
  }
  const knownMacroGrams =
    totals.protein_g.amount + totals.carbs_g.amount + totals.fat_g.amount;
  // Allow roundoff from conversion and summation at the physical limits.
  const roundoff = Number.EPSILON * (ingredients.length + 4);
  const exceeds = (amount: number, limit: number) =>
    amount - limit > limit * roundoff;
  if (
    exceeds(totals.kcal.amount, 9 * cooked_grams) ||
    exceeds(knownMacroGrams, cooked_grams)
  )
    throw new OperationError(400, "cooked_weight_too_low");

  return {
    ...numbers,
    name,
    serving_size: 100,
    serving_unit: "g",
    provenance,
    source: `Home recipe: ${ingredients.length} ingredients, ${cooked_grams} g cooked`,
    source_food_id: null,
  };
}

const batchFoodName = "save_batch_food";
const saveBatchFood = defineOperation({
  name: batchFoodName,
  description:
    "Save a cooked batch as a food per 100 g. Send a UUID mutation_id, a name, cooked_grams (weigh the cooked food without the pot), and 1 to 40 ingredients with positive grams and exactly one food_id or source_food_id each. Each weight is at most 100,000 g. Ingredients need a weight-based serving and known kcal. Use add_source_food first to cache USDA foods and lookup_barcode or search_online to cache Open Food Facts foods. Log a weighed portion with log_food using food_id and servings = portion grams / 100. Reuse the same mutation_id and inputs to retry.",
  modes: ["access", "fallback"],
  callerClass: "browser_and_agent",
  admin: false,
  method: "POST",
  path: "/api/foods/batch",
  bodyLimit: 8192,
  input: batchInput,
  mcpInput: zod.looseObject({
    mutation_id: zod.unknown().optional(),
    name: zod.unknown().optional(),
    cooked_grams: zod.unknown().optional(),
    ingredients: zod
      .union([zod.array(zod.unknown()), zod.unknown()])
      .optional(),
  }),
  inputRejection(error) {
    const issue = error.issues.find(
      ({ path }) => path[0] === "ingredients" && typeof path[1] === "number",
    );
    const index = issue?.path[1];
    return typeof index === "number"
      ? foodPartError("invalid_part", index + 1)
      : undefined;
  },
  output: foodOutput,
  handler({ mutation_id, ...input }, context) {
    const person = operationPerson(context);
    const requestHash = createHash("sha256")
      .update(JSON.stringify([batchFoodName, input]))
      .digest("hex");
    return saveFoodOnce(context, person.id, mutation_id, requestHash, (scope) =>
      batchValues(scope, person, input),
    );
  },
});

export const foodOperations = [createFood, editFood, saveBatchFood];
