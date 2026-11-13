import { createHash } from "node:crypto";
import { fromStoredNutrition, toStoredNutrition } from "@tare/nutrition";
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
import { selectSourceFood } from "../queries/select-source-food.ts";

export type OwnedFoodValues = Numbers & {
  name: string;
  serving_size: number;
  serving_unit: string;
  provenance: "label" | "estimated";
  source: string | null;
  source_food_id: number | null;
};

/** Validates and inserts one owned food in the caller's transaction; callers keep their own replay records. */
export function insertOwnedFood(
  scope: WriteScope,
  userId: number,
  values: OwnedFoodValues,
) {
  const database = scopeDatabase(scope);
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
  if (values.source_food_id !== null) {
    const evidence = selectSourceFood(database, { id: values.source_food_id });
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
  const food = insertFood(database, {
    ...numbers,
    ...nutrition.row,
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
  output: zod.strictObject({ food: foodView, created: zod.boolean() }),
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
      const {
        user_id: _owner,
        service: _service,
        meal_name: _mealName,
        chef: _chef,
        meal_key: _mealKey,
        ...view
      } = food;
      return {
        status: prior ? 200 : 201,
        body: { food: view, created: !prior },
      };
    });
  },
});

export const foodOperations = [createFood];
