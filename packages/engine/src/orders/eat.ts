import { z as zod } from "zod";
import type { Person } from "../auth/middleware.ts";
import { scopeDatabase, type WriteScope } from "../db.ts";
import { localDay } from "../logging/day.ts";
import { type IntakeInput, insertIntake } from "../logging/intake.ts";
import { intakeRow } from "../logging/schemas.ts";
import { mealNutritionState } from "../meal-nutrition/index.ts";
import { OperationError } from "../operations/registry.ts";
import type { PantryStock, StockOutcome } from "../pantry/requests.ts";
import { retainedStock, stockResult, stockView } from "../pantry/stock-view.ts";
import { markPlannedItem } from "../queries/mark-planned-item.ts";
import { consumeOrderMeal } from "../queries/orders/consume-order-meal.ts";
import { insertMealAction } from "../queries/orders/insert-meal-action.ts";
import { selectMealAction } from "../queries/orders/select-meal-action.ts";
import { selectOrder } from "../queries/orders/select-order.ts";
import { selectOrderMeal } from "../queries/orders/select-order-meal.ts";
import { selectIntakeByClient } from "../queries/select-intake-by-client.ts";
import { selectIntakeEntry } from "../queries/select-intake-entry.ts";
import { selectPlannedItem } from "../queries/select-planned-item.ts";
import { isDue } from "./index.ts";

export const eatMealInput = zod.strictObject({
  meal_id: zod.number().int().positive(),
  revision: zod.number().int().positive(),
  action: zod.enum(["ate", "ate_three_quarters"]),
  mutation_id: zod.string().trim().min(1).max(100),
});
const mealResult = zod.strictObject({
  id: zod.number().int().positive(),
  quantity: zod.number().int().nonnegative(),
  revision: zod.number().int().positive(),
});
export const eatMealOutput = zod.strictObject({
  entry: intakeRow,
  meal: mealResult,
  stock: stockResult.optional(),
});
export const plannedItemActionInput = zod.strictObject({
  item_id: zod.number().int().positive(),
  revision: eatMealInput.shape.revision,
  action: zod.enum(["ate", "ate_three_quarters", "skip"]),
  mutation_id: eatMealInput.shape.mutation_id,
});
export const plannedItemActionOutput = zod.strictObject({
  item: zod.strictObject({
    id: zod.number().int().positive(),
    revision: zod.number().int().positive(),
    state: zod.enum(["eaten", "skipped"]),
  }),
  entry: intakeRow.nullable(),
  meal: mealResult.nullable(),
  stock: stockResult.optional(),
});

export function eatOrderMeal(
  scope: WriteScope,
  person: Person,
  input: zod.infer<typeof eatMealInput>,
  now: string,
): zod.infer<typeof eatMealOutput> {
  return eatMealOutput.parse(applyMealAction(scope, person, input, now, null));
}

export function actOnPlannedItem(
  scope: WriteScope,
  person: Person,
  input: zod.infer<typeof plannedItemActionInput>,
  now: string,
  stock: PantryStock,
): zod.infer<typeof plannedItemActionOutput> {
  return plannedItemActionOutput.parse(
    applyMealAction(scope, person, input, now, stock),
  );
}

function applyMealAction(
  scope: WriteScope,
  person: Person,
  input:
    | zod.infer<typeof eatMealInput>
    | zod.infer<typeof plannedItemActionInput>,
  now: string,
  stock: PantryStock | null,
) {
  const database = scopeDatabase(scope);
  const planned = "item_id" in input;
  const receipt = selectMealAction(database, {
    user_id: person.id,
    mutation_id: input.mutation_id,
  });
  if (receipt) {
    if (
      receipt.action !== input.action ||
      (planned
        ? receipt.planned_item_id !== input.item_id
        : receipt.planned_item_id !== null ||
          receipt.order_meal_id !== input.meal_id)
    )
      throw new OperationError(409, "mutation_conflict");
    const saved = (planned ? plannedItemActionOutput : eatMealOutput).parse(
      JSON.parse(receipt.result),
    );
    return { ...saved, stock: replayStock(scope, person, receipt, stock) };
  }
  const item = planned
    ? selectPlannedItem(database, { user_id: person.id, id: input.item_id })
    : null;
  if (planned) {
    if (!item) throw new OperationError(404, "planned_item_not_found");
    if (item.revision !== input.revision || item.state !== "planned")
      throw new OperationError(409, "stale_revision");
    if (item.day !== localDay(now, person.timezone, person.day_start_hour))
      throw new OperationError(409, "planned_item_not_today");
  }
  let entry: ReturnType<typeof insertIntake>["entry"] | null = null;
  let consumed: zod.infer<typeof mealResult> | null = null;
  let mealId: number | null = null;
  let outcome: StockOutcome | null = null;
  if (input.action !== "skip") {
    mealId = planned ? (item?.order_meal_id ?? null) : input.meal_id;
    const meal =
      mealId === null
        ? null
        : selectOrderMeal(database, { user_id: person.id, id: mealId });
    if (mealId !== null && !meal)
      throw new OperationError(404, "meal_not_found");
    if (!planned && meal?.revision !== input.revision)
      throw new OperationError(409, "stale_revision");
    let foodId = item?.food_id ?? null;
    if (meal) {
      if (meal.quantity < 1) throw new OperationError(409, "meal_out_of_stock");
      const order = selectOrder(database, {
        user_id: person.id,
        id: meal.order_id,
      });
      if (!order) throw new Error("Meal order is missing");
      if (!isDue(order, person, now))
        throw new OperationError(409, "meal_not_due");
      const nutrition = mealNutritionState(database, person.id, {
        service: order.service,
        name: meal.name,
        chef: meal.chef,
      });
      if (nutrition.status === "pending")
        throw new OperationError(409, "meal_nutrition_pending");
      if (nutrition.status === "unknown")
        throw new OperationError(409, "meal_nutrition_missing");
      foodId = nutrition.food_id;
    }
    if (
      selectIntakeByClient(database, {
        user_id: person.id,
        client_id: input.mutation_id,
      })
    )
      throw new OperationError(409, "mutation_conflict");
    if (item && (item.template_id === null || item.position === null))
      throw new OperationError(400, "slot_not_found");
    if (foodId === null) throw new Error("Meal action has no food");
    const intake: IntakeInput = {
      client_id: input.mutation_id,
      reference: { kind: "food", id: foodId },
      servings:
        (meal ? 1 : (item?.servings ?? 1)) *
        (input.action === "ate" ? 1 : 0.75),
      claim: {},
      ...(item
        ? {
            slot: {
              template_id: item.template_id as number,
              position: item.position as number,
            },
          }
        : {}),
    };
    const clock = { now: () => new Date(now) };
    // Order meals draw on Tare's own order stock, never the pantry.
    if (meal || !stock)
      entry = insertIntake(scope, person, intake, clock, "suppress").entry;
    else {
      const written = insertIntake(scope, person, intake, clock, stock);
      entry = written.entry;
      outcome = written.stock;
    }
    if (meal) {
      const changed = consumeOrderMeal(
        database,
        { updated_at: now },
        {
          user_id: person.id,
          id: meal.id,
          revision: meal.revision,
        },
      );
      if (changed.length !== 1) throw new Error("Meal update returned no row");
      consumed = mealResult.parse(changed[0]);
    }
  }
  const marked = item
    ? markPlannedItem(
        database,
        {
          state: input.action === "skip" ? "skipped" : "eaten",
          updated_at: now,
        },
        { user_id: person.id, id: item.id, revision: input.revision },
      )
    : null;
  if (marked && marked.length !== 1)
    throw new Error("Planned item update returned no row");
  const result = item
    ? plannedItemActionOutput.parse({
        item: marked?.[0],
        entry,
        meal: consumed,
      })
    : eatMealOutput.parse({ entry, meal: consumed });
  const inserted = insertMealAction(database, {
    user_id: person.id,
    mutation_id: input.mutation_id,
    order_meal_id: mealId,
    planned_item_id: item?.id ?? null,
    action: input.action,
    intake_entry_id: entry?.id ?? null,
    result: JSON.stringify(result),
    created_at: now,
  });
  if (inserted.changes !== 1) throw new Error("Meal action insert failed");
  return { ...result, stock: stockView(database, outcome) };
}

/** Current stock for a stored receipt; only planned grocery food ever had a request. */
function replayStock(
  scope: WriteScope,
  person: Person,
  receipt: NonNullable<ReturnType<typeof selectMealAction>>,
  stock: PantryStock | null,
) {
  const database = scopeDatabase(scope);
  if (
    !stock ||
    receipt.action === "skip" ||
    receipt.order_meal_id !== null ||
    receipt.intake_entry_id === null
  )
    return undefined;
  const live = selectIntakeEntry(database, {
    user_id: person.id,
    id: receipt.intake_entry_id,
  });
  // SQLite can reuse a deleted intake's id, so the client id must match too.
  if (live?.client_id === receipt.mutation_id)
    return stockView(database, stock.record(scope, person.id, live, false));
  return retainedStock(database, person.id, receipt.mutation_id);
}
