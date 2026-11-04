import { foldName } from "@tare/nutrition";
import { z as zod } from "zod";
import type { Person } from "../auth/middleware.ts";
import { scopeDatabase, type WriteScope } from "../db.ts";
import { askMealNutrition, mealKey } from "../meal-nutrition/index.ts";
import { createOrder, isDue, updateMeal } from "../orders/index.ts";
import { deleteExpectedMeal } from "../queries/orders/delete-expected-meal.ts";
import { insertOrderMeal } from "../queries/orders/insert-order-meal.ts";
import { listReconcileMeals } from "../queries/orders/list-reconcile-meals.ts";
import { selectDeliveryOrder } from "../queries/orders/select-delivery-order.ts";
import type { SelectOrderResult } from "../queries/orders/select-order.ts";
import { updateOrderSource } from "../queries/orders/update-order-source.ts";
import { selectOpenOrderQuestion } from "../queries/select-open-order-question.ts";
import {
  type SelectReconcileEmailResult,
  selectReconcileEmail,
} from "../queries/select-reconcile-email.ts";
import { updateEmailReconciliation } from "../queries/update-email-reconciliation.ts";
import {
  type ApplyOutcome,
  createQuestion,
  type QuestionKind,
} from "../questions/kinds.ts";
import {
  type CompleteOrder,
  manualOrder,
  readCompleteOrder,
} from "./reconcile-input.ts";

type Kinds = ReadonlyMap<string, QuestionKind>;
export const lateTarget = zod.discriminatedUnion("type", [
  zod.strictObject({ type: zod.literal("existing"), id: zod.number().int() }),
  zod.strictObject({
    type: zod.literal("new"),
    service: zod.string(),
    delivery_date: zod.iso.date(),
  }),
]);
export const lateAnswer = zod.strictObject({
  action: zod.enum(["accept", "ignore"]),
});

export function finishEmail(
  scope: WriteScope,
  email: SelectReconcileEmailResult,
  now: string,
  disposition: "reconciled" | "questioned",
  orderId: number | null,
  manual: CompleteOrder,
) {
  if (
    updateEmailReconciliation(
      scopeDatabase(scope),
      {
        disposition,
        now,
        manual_result: JSON.stringify(manual),
        applied_order_id: orderId,
      },
      email,
    ).changes !== 1
  )
    throw new Error("Email update failed");
}

function applyList(
  scope: WriteScope,
  email: SelectReconcileEmailResult,
  person: Person,
  input: CompleteOrder,
  order: SelectOrderResult | null,
  now: string,
  kinds: Kinds,
): ApplyOutcome {
  const database = scopeDatabase(scope);
  const { service } = input;
  if (order) {
    const prior =
      order.applied_email_id === null
        ? null
        : selectReconcileEmail(database, {
            user_id: person.id,
            id: order.applied_email_id,
          });
    const loses =
      (order.status === "processed" && input.kind === "scheduling") ||
      (order.status ===
        (input.kind === "scheduling" ? "scheduled" : "processed") &&
        prior !== null &&
        (prior.created_at > email.created_at ||
          (prior.created_at === email.created_at && prior.id > email.id)));
    if (loses) {
      finishEmail(scope, email, now, "reconciled", null, input);
      return { status: "superseded" };
    }
  } else
    order = createOrder(
      scope,
      person,
      {
        service,
        delivery_date: input.delivery_date,
        status: input.kind === "scheduling" ? "scheduled" : "processed",
        meals: [],
      },
      kinds,
      now,
    );
  const desired = new Map<string, CompleteOrder["meals"][number]>();
  for (const meal of input.meals) {
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
      updateMeal(scope, person.id, meal.id, replacement, now);
      desired.delete(key);
    } else if (meal.has_actions)
      updateMeal(scope, person.id, meal.id, { quantity: 0 }, now);
    else deleteExpectedMeal(database, { user_id: person.id, id: meal.id });
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
    askMealNutrition(database, person.id, { ...meal, service }, now, kinds);
  }
  if (
    updateOrderSource(
      database,
      {
        status: input.kind === "scheduling" ? "scheduled" : "processed",
        applied_email_id: email.id,
      },
      { user_id: person.id, id: order.id },
    ).changes !== 1
  )
    throw new Error("Order update failed");
  finishEmail(scope, email, now, "reconciled", order.id, input);
  return { status: "applied" };
}

export function reconcileEmail(
  scope: WriteScope,
  identity: { id: number; user_id: number },
  person: Person,
  now: string,
  kinds: Kinds,
): void {
  const database = scopeDatabase(scope);
  if (identity.user_id !== person.id) throw new Error("Email owner mismatch");
  const email = selectReconcileEmail(database, identity);
  if (!email) throw new Error("Email is missing");
  if (email.disposition !== null || email.parse_state !== "parsed") return;
  const input = readCompleteOrder(email);
  if (!input) return;
  const order = selectDeliveryOrder(database, {
    user_id: person.id,
    service: input.service,
    delivery_date: input.delivery_date,
  });
  const existing = order
    ? listReconcileMeals(database, { user_id: person.id, order_id: order.id })
    : [];
  for (const meal of input.meals) {
    if (meal.chef !== null) continue;
    const matches = existing.filter(
      (candidate) => foldName(candidate.name) === foldName(meal.name),
    );
    const chefs = new Map(
      matches.map((candidate) => [
        foldName(candidate.chef ?? ""),
        candidate.chef,
      ]),
    );
    if (chefs.size > 1) return;
    if (chefs.size === 1) meal.chef = [...chefs.values()][0] ?? null;
  }
  if (
    isDue(
      order ?? { delivered_at: null, delivery_date: input.delivery_date },
      person,
      now,
    )
  ) {
    finishEmail(scope, email, now, "questioned", null, input);
    if (
      !selectOpenOrderQuestion(database, {
        user_id: person.id,
        subject_ref: String(email.id),
        kind: "order_late_list",
      })
    ) {
      const target = order
        ? { type: "existing", id: order.id }
        : {
            type: "new",
            service: input.service,
            delivery_date: input.delivery_date,
          };
      const schema = order
        ? zod.strictObject({ action: zod.literal("ignore") })
        : lateAnswer;
      createQuestion(
        database,
        {
          userId: person.id,
          subjectRef: String(email.id),
          kind: "order_late_list",
          prompt: "Review the late order list.",
          answerSchema: {
            ...zod.toJSONSchema(schema, { target: "draft-7", io: "input" }),
            target,
          },
        },
        { now: () => new Date(now) },
        kinds,
      );
    }
    return;
  }
  applyList(scope, email, person, input, order, now, kinds);
}

export function acceptLateList(
  scope: WriteScope,
  email: SelectReconcileEmailResult,
  person: Person,
  now: string,
  kinds: Kinds,
): ApplyOutcome {
  const database = scopeDatabase(scope);
  const input = manualOrder.parse(JSON.parse(email.manual_result ?? "null"));
  let order: SelectOrderResult;
  try {
    order = createOrder(
      scope,
      person,
      {
        service: input.service,
        delivery_date: input.delivery_date,
        status: input.kind === "scheduling" ? "scheduled" : "processed",
        meals: [],
      },
      kinds,
      now,
    );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "SQLITE_CONSTRAINT_UNIQUE"
    )
      throw error;
    const existing = selectDeliveryOrder(database, {
      user_id: person.id,
      service: input.service,
      delivery_date: input.delivery_date,
    });
    if (!existing) throw error;
    if (
      isDue(existing, person, now) ||
      listReconcileMeals(database, {
        user_id: person.id,
        order_id: existing.id,
      }).some((meal) => meal.has_actions)
    ) {
      finishEmail(scope, email, now, "reconciled", null, input);
      return { status: "superseded" };
    }
    order = existing;
  }
  return applyList(scope, email, person, input, order, now, kinds);
}
