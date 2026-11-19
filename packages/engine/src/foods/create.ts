import { createHash } from "node:crypto";
import { fromStoredNutrition, toStoredNutrition } from "@tare/nutrition";
import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import { scopeDatabase, type WriteScope, writeTransaction } from "../db.ts";
import { resolveProvenance } from "../logging/provenance.ts";
import {
  type Numbers,
  numbersFrom,
  nutrientFields,
  validateNumbers,
} from "../logging/schemas.ts";
import {
  defineOperation,
  OperationError,
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
    const request_hash = createHash("sha256")
      .update(JSON.stringify(values))
      .digest("hex");
    return writeTransaction(context.database, (scope) => {
      const database = scopeDatabase(scope);
      // SQLite compares text exactly, so one UUID in two cases must share a receipt.
      const key = {
        user_id: userId,
        mutation_id: input.mutation_id.toLowerCase(),
      };
      const prior = selectFoodReceipt(database, key);
      if (prior && prior.request_hash !== request_hash)
        throw new OperationError(409, "mutation_conflict");
      const food = prior
        ? selectFood(database, { user_id: userId, id: prior.food_id })
        : insertOwnedFood(scope, userId, values);
      if (!food) throw new Error("Receipted food not found");
      if (!prior)
        insertFoodReceipt(database, {
          ...key,
          request_hash,
          food_id: food.id,
          created_at: context.clock.now().toISOString(),
        });
      return {
        status: prior ? 200 : 201,
        body: { food: viewOfFood(food), created: !prior },
      };
    });
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

export const foodOperations = [createFood, editFood];
