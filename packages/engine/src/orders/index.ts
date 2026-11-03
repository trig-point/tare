import type { Database } from "better-sqlite3";
import type { Person } from "../auth/middleware.ts";
import { scopeDatabase, type WriteScope } from "../db.ts";
import { localDay } from "../logging/day.ts";
import { askMealNutrition } from "../meal-nutrition/index.ts";
import { insertOrder } from "../queries/orders/insert-order.ts";
import { insertOrderMeal } from "../queries/orders/insert-order-meal.ts";
import { listMealCandidates } from "../queries/orders/list-meal-candidates.ts";
import { recordOrderDelivery } from "../queries/orders/record-order-delivery.ts";
import { selectOrderMeal } from "../queries/orders/select-order-meal.ts";
import { updateOrderMeal } from "../queries/orders/update-order-meal.ts";
import type { QuestionKind } from "../questions/kinds.ts";

type MealInput = { name: string; chef: string | null; quantity: number };
type DueOrder = { delivered_at: string | null; delivery_date: string };

export function isDue(order: DueOrder, person: Person, now: string): boolean {
  return (
    order.delivered_at !== null ||
    localDay(now, person.timezone, person.day_start_hour) >= order.delivery_date
  );
}

export function recordDelivery(
  scope: WriteScope,
  userId: number,
  orderId: number,
  now: string,
): boolean {
  return (
    recordOrderDelivery(
      scopeDatabase(scope),
      { delivered_at: now },
      {
        user_id: userId,
        id: orderId,
      },
    ).length > 0
  );
}

export function createOrder(
  scope: WriteScope,
  person: Person,
  input: {
    service: string;
    delivery_date: string;
    status: "scheduled" | "processed";
    meals: MealInput[];
  },
  questionKinds: ReadonlyMap<string, QuestionKind>,
  now = new Date().toISOString(),
) {
  const database = scopeDatabase(scope);
  const order = insertOrder(database, {
    user_id: person.id,
    service: input.service,
    delivery_date: input.delivery_date,
    status: input.status,
    created_at: now,
  });
  if (!order) throw new Error("Order insert returned no row");
  for (const meal of input.meals) {
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
      { ...meal, service: input.service },
      now,
      questionKinds,
    );
  }
  return order;
}

export function updateMeal(
  scope: WriteScope,
  userId: number,
  mealId: number,
  changes: Partial<MealInput>,
  now = new Date().toISOString(),
) {
  const database = scopeDatabase(scope);
  const meal = selectOrderMeal(database, { user_id: userId, id: mealId });
  if (!meal) return null;
  return updateOrderMeal(
    database,
    {
      ...meal,
      ...changes,
      updated_at: now,
    },
    { user_id: userId, id: mealId },
  );
}

export function listMealsOnHand(
  database: Database,
  person: Person,
  now: string,
) {
  return listMealCandidates(database, { user_id: person.id })
    .filter((meal) => isDue(meal, person, now))
    .map(({ delivered_at: _deliveredAt, ...meal }) => meal);
}
