import type { Database } from "better-sqlite3";
import type { z as zod } from "zod";
import { writeTransaction } from "../db.ts";
import { resolveGrocyOwner } from "../grocy/config.ts";
import { localDay } from "../logging/day.ts";
import { mealNutritionState } from "../meal-nutrition/index.ts";
import {
  type OperationContext,
  OperationError,
  type OperationResult,
  operationPerson,
} from "../operations/registry.ts";
import { isDue } from "../orders/index.ts";
import {
  type InsertPlannedItemResult,
  insertPlannedItem,
} from "../queries/insert-planned-item.ts";
import { listPlannedItems } from "../queries/list-planned-items.ts";
import { selectOrder } from "../queries/orders/select-order.ts";
import { selectOrderMeal } from "../queries/orders/select-order-meal.ts";
import { selectFood } from "../queries/select-food.ts";
import { selectPlannedSlot } from "../queries/select-planned-slot.ts";
import { updatePlannedItem } from "../queries/update-planned-item.ts";
import { selectedTemplate } from "./reader.ts";
import { plannedItemSchema, type planSlotInput } from "./schema.ts";

function ownedMeal(database: Database, user_id: number, id: number) {
  const meal = selectOrderMeal(database, { user_id, id });
  if (!meal) throw new OperationError(404, "meal_not_found");
  const order = selectOrder(database, { user_id, id: meal.order_id });
  if (!order) throw new Error("Meal order is missing");
  return { meal, order };
}

function itemView(database: Database, row: InsertPlannedItemResult) {
  let reference: zod.infer<typeof plannedItemSchema>["reference"];
  let status: zod.infer<typeof plannedItemSchema>["nutrition"]["status"];
  if (row.order_meal_id !== null) {
    const { meal, order } = ownedMeal(database, row.user_id, row.order_meal_id);
    reference = { kind: "meal", id: meal.id, name: meal.name };
    status = mealNutritionState(database, row.user_id, {
      service: order.service,
      name: meal.name,
      chef: meal.chef,
    }).status;
  } else {
    if (row.food_id === null) throw new Error("Planned item has no reference");
    const food = selectFood(database, {
      user_id: row.user_id,
      id: row.food_id,
    });
    if (!food) throw new Error("Planned food is missing");
    reference = { kind: "food", id: food.id, name: food.name };
    status = "known";
  }
  return plannedItemSchema.parse({
    id: row.id,
    revision: row.revision,
    state: row.state,
    template_id: row.template_id,
    position: row.position,
    reference,
    servings: row.servings,
    nutrition: { status },
  });
}

export function readPlannedItems(
  database: Database,
  user_id: number,
  day: string,
  template_id: number,
) {
  return listPlannedItems(database, { user_id, day, template_id }).map((row) =>
    itemView(database, row),
  );
}

export function planSlot(
  input: zod.infer<typeof planSlotInput>,
  context: OperationContext,
): OperationResult {
  return writeTransaction(context.database, () => {
    const { database } = context;
    const person = operationPerson(context);
    const instant = context.clock.now();
    const now = instant.toISOString();
    const day = localDay(now, person.timezone, person.day_start_hour);
    const plan = selectedTemplate(database, person, day, instant);
    if (!plan.template) throw new OperationError(409, "no_day_type");
    if (!plan.slots.some((slot) => slot.position === input.position))
      throw new OperationError(400, "slot_not_found");
    if (input.meal_id !== undefined) {
      const { meal, order } = ownedMeal(database, person.id, input.meal_id);
      if (meal.quantity < 1) throw new OperationError(409, "meal_out_of_stock");
      if (!isDue(order, person, now))
        throw new OperationError(409, "meal_not_due");
    } else {
      if (
        !selectFood(database, {
          user_id: person.id,
          id: input.food_id as number,
        })
      )
        throw new OperationError(404, "food_not_found");
      // The owner's food cannot be checked against the pantry without its service.
      const { grocy } = context.config;
      if (
        grocy &&
        !context.pantry &&
        resolveGrocyOwner(database, grocy) === person.id
      )
        throw new OperationError(503, "pantry_unavailable");
    }
    const key = {
      user_id: person.id,
      day,
      template_id: plan.template.id,
      position: input.position,
    };
    const current = selectPlannedSlot(database, key);
    const values = {
      order_meal_id: input.meal_id ?? null,
      food_id: input.food_id ?? null,
      servings: input.food_id === undefined ? null : (input.servings ?? 1),
      updated_at: now,
    };
    const caveat = () => {
      if (values.food_id === null || values.servings === null) return {};
      const pantry = context.pantry?.foodAvailability(
        person.id,
        values.food_id,
        values.servings,
        instant,
      );
      return pantry ? { pantry } : {};
    };
    if (
      input.item_id === undefined
        ? current !== null
        : current?.id !== input.item_id || current.revision !== input.revision
    )
      throw new OperationError(409, "stale_revision");
    if (
      current &&
      current.order_meal_id === values.order_meal_id &&
      current.food_id === values.food_id &&
      current.servings === values.servings
    )
      return {
        status: 200,
        body: { item: itemView(database, current), ...caveat() },
      };
    const row = current
      ? updatePlannedItem(database, values, {
          ...key,
          id: current.id,
          revision: current.revision,
        })[0]
      : insertPlannedItem(database, { ...key, ...values, created_at: now });
    if (!row) {
      if (current) throw new OperationError(409, "stale_revision");
      throw new Error("Planned item insert returned no row");
    }
    return {
      status: current ? 200 : 201,
      body: { item: itemView(database, row), ...caveat() },
    };
  });
}
