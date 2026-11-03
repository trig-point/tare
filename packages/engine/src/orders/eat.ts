import { z as zod } from "zod";
import type { Person } from "../auth/middleware.ts";
import { scopeDatabase, type WriteScope } from "../db.ts";
import { insertIntake } from "../logging/intake.ts";
import { intakeRow } from "../logging/schemas.ts";
import { mealNutritionState } from "../meal-nutrition/index.ts";
import { OperationError } from "../operations/registry.ts";
import { consumeOrderMeal } from "../queries/orders/consume-order-meal.ts";
import { insertMealAction } from "../queries/orders/insert-meal-action.ts";
import { selectMealAction } from "../queries/orders/select-meal-action.ts";
import { selectOrder } from "../queries/orders/select-order.ts";
import { selectOrderMeal } from "../queries/orders/select-order-meal.ts";
import { selectIntakeByClient } from "../queries/select-intake-by-client.ts";
import { isDue } from "./index.ts";

export const eatMealInput = zod.strictObject({
  meal_id: zod.number().int().positive(),
  revision: zod.number().int().positive(),
  action: zod.enum(["ate", "ate_three_quarters"]),
  mutation_id: zod.string().trim().min(1).max(100),
});
export const eatMealOutput = zod.strictObject({
  entry: intakeRow,
  meal: zod.strictObject({
    id: zod.number().int().positive(),
    quantity: zod.number().int().nonnegative(),
    revision: zod.number().int().positive(),
  }),
});

export function eatOrderMeal(
  scope: WriteScope,
  person: Person,
  input: zod.infer<typeof eatMealInput>,
  now: string,
): zod.infer<typeof eatMealOutput> {
  const database = scopeDatabase(scope);
  const receipt = selectMealAction(database, {
    user_id: person.id,
    mutation_id: input.mutation_id,
  });
  if (receipt) {
    if (
      receipt.order_meal_id !== input.meal_id ||
      receipt.action !== input.action
    )
      throw new OperationError(409, "mutation_conflict");
    return eatMealOutput.parse(JSON.parse(receipt.result));
  }
  const meal = selectOrderMeal(database, {
    user_id: person.id,
    id: input.meal_id,
  });
  if (!meal) throw new OperationError(404, "meal_not_found");
  if (meal.revision !== input.revision)
    throw new OperationError(409, "stale_revision");
  if (meal.quantity < 1) throw new OperationError(409, "meal_out_of_stock");
  const order = selectOrder(database, {
    user_id: person.id,
    id: meal.order_id,
  });
  if (!order) throw new Error("Meal order is missing");
  if (!isDue(order, person, now)) throw new OperationError(409, "meal_not_due");
  const nutrition = mealNutritionState(database, person.id, {
    service: order.service,
    name: meal.name,
    chef: meal.chef,
  });
  if (nutrition.status === "pending")
    throw new OperationError(409, "meal_nutrition_pending");
  if (nutrition.status === "unknown")
    throw new OperationError(409, "meal_nutrition_missing");
  if (
    selectIntakeByClient(database, {
      user_id: person.id,
      client_id: input.mutation_id,
    })
  )
    throw new OperationError(409, "mutation_conflict");
  const { entry } = insertIntake(
    scope,
    person,
    {
      client_id: input.mutation_id,
      reference: { kind: "food", id: nutrition.food_id },
      servings: input.action === "ate" ? 1 : 0.75,
      claim: {},
    },
    { now: () => new Date(now) },
  );
  const changed = consumeOrderMeal(
    database,
    { updated_at: now },
    { user_id: person.id, id: meal.id, revision: input.revision },
  );
  if (changed.length !== 1) throw new Error("Meal update returned no row");
  const result = eatMealOutput.parse({ entry, meal: changed[0] });
  const inserted = insertMealAction(database, {
    user_id: person.id,
    mutation_id: input.mutation_id,
    order_meal_id: meal.id,
    action: input.action,
    intake_entry_id: entry.id,
    result: JSON.stringify(result),
    created_at: now,
  });
  if (inserted.changes !== 1) throw new Error("Meal action insert failed");
  return result;
}
