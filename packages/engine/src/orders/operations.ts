import { createHash } from "node:crypto";
import { z as zod } from "zod";
import { writeTransaction } from "../db.ts";
import { reconcileEmail } from "../inbound/reconcile.ts";
import { manualOrder, serviceIdentity } from "../inbound/reconcile-input.ts";
import { mealKey } from "../meal-nutrition/index.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { insertAgentOrder } from "../queries/orders/insert-agent-order.ts";
import { selectOrder } from "../queries/orders/select-order.ts";
import { selectInboundEmail } from "../queries/select-inbound-email.ts";
import { selectReconcileEmail } from "../queries/select-reconcile-email.ts";
import { eatMealInput, eatMealOutput, eatOrderMeal } from "./eat.ts";
import { listMealsOnHand, recordDelivery } from "./index.ts";

const shared = {
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser_and_agent",
  admin: false,
} as const;

const recordOrderInput = manualOrder
  .omit({ kind: true, delivery_date: true })
  .extend({
    delivery_date: zod.iso.date(),
    status: zod.enum(["scheduled", "processed"]),
    meals: zod
      .array(
        manualOrder.shape.meals.element.extend({
          chef: manualOrder.shape.meals.element.shape.chef.optional(),
        }),
      )
      .min(1)
      .max(30),
  });

export const orderOperations = [
  defineOperation({
    ...shared,
    name: "eat_meal",
    method: "POST",
    path: "/api/meals/eat",
    bodyLimit: 8192,
    input: eatMealInput,
    output: eatMealOutput,
    handler(input, context) {
      const person = operationPerson(context);
      return writeTransaction(context.database, (scope) => ({
        status: 200,
        body: eatOrderMeal(
          scope,
          person,
          input,
          context.clock.now().toISOString(),
        ),
      }));
    },
  }),
  defineOperation({
    ...shared,
    name: "mark_delivery",
    method: "POST",
    path: "/api/orders/mark-delivery",
    bodyLimit: 8192,
    input: zod.strictObject({ order_id: zod.number().int().positive() }),
    output: zod.strictObject({
      order_id: zod.number().int(),
      delivered_at: zod.string(),
    }),
    handler(input, context) {
      const person = operationPerson(context);
      return writeTransaction(context.database, (scope) => {
        const params = { user_id: person.id, id: input.order_id };
        const order = selectOrder(context.database, params);
        if (!order) throw new OperationError(404, "not_found");
        const now = context.clock.now().toISOString();
        recordDelivery(scope, person.id, order.id, now);
        return {
          status: 200,
          body: { order_id: order.id, delivered_at: order.delivered_at ?? now },
        };
      });
    },
  }),
  defineOperation({
    ...shared,
    name: "record_order",
    description:
      "Record a meal-kit order read from the service account; a repeat of a list already recorded changes nothing, even after a newer list.",
    method: "POST",
    path: "/api/orders/record",
    bodyLimit: 16384,
    input: recordOrderInput,
    output: zod.strictObject({
      order_id: zod.number().int().nullable(),
      outcome: zod.enum(["reconciled", "superseded", "questioned"]),
      repeat: zod.boolean(),
    }),
    handler(input, context) {
      const person = operationPerson(context);
      const services = context.config.orderEmailServices;
      const order = manualOrder.parse({
        service: serviceIdentity(input.service, services),
        kind: input.status === "scheduled" ? "scheduling" : "processed",
        delivery_date: input.delivery_date,
        meals: input.meals.map((meal) => ({
          ...meal,
          chef: meal.chef ?? null,
        })),
      });
      const manual = JSON.stringify(order);
      const quantities = new Map<string, number>();
      for (const meal of order.meals) {
        const key = mealKey({ ...meal, service: order.service });
        quantities.set(key, (quantities.get(key) ?? 0) + meal.quantity);
      }
      // Reconcile treats meals as a keyed set, so reordered or recased lists are repeats.
      const canonical = JSON.stringify({
        service: order.service,
        kind: order.kind,
        delivery_date: order.delivery_date,
        meals: [...quantities].sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
        ),
      });
      const dedupeKey = `agent:${createHash("sha256").update(canonical).digest("hex")}`;
      const questionKinds = context.questionKinds;
      if (!questionKinds) throw new Error("Question kinds missing");
      return writeTransaction(context.database, (scope) => {
        const now = context.clock.now().toISOString();
        const inserted = insertAgentOrder(context.database, {
          user_id: person.id,
          service: order.service,
          dedupe_key: dedupeKey,
          raw: Buffer.from(manual),
          manual_result: manual,
          now,
        });
        const id =
          inserted?.id ??
          selectInboundEmail(context.database, {
            user_id: person.id,
            dedupe_key: dedupeKey,
          })?.id;
        if (id === undefined) throw new Error("Agent order row missing");
        const source = { id, user_id: person.id };
        if (inserted)
          reconcileEmail(
            scope,
            source,
            person,
            now,
            { questionKinds, services },
            "job",
          );
        const row = selectReconcileEmail(context.database, source);
        if (!row) throw new Error("Agent order row missing");
        return {
          status: inserted ? 201 : 200,
          body: {
            order_id: row.applied_order_id,
            outcome:
              row.disposition === "questioned"
                ? "questioned"
                : row.applied_order_id === null
                  ? "superseded"
                  : "reconciled",
            repeat: !inserted,
          },
        };
      });
    },
  }),
  defineOperation({
    ...shared,
    name: "list_meals_on_hand",
    method: "GET",
    path: "/api/meals/on-hand",
    input: zod.strictObject({}),
    output: zod.strictObject({
      meals: zod.array(
        zod.strictObject({
          id: zod.number().int(),
          order_id: zod.number().int(),
          name: zod.string(),
          chef: zod.string().nullable(),
          quantity: zod.number().int().positive(),
          revision: zod.number().int().positive(),
          delivery_date: zod.string(),
        }),
      ),
    }),
    handler(_input, context) {
      return {
        status: 200,
        body: {
          meals: listMealsOnHand(
            context.database,
            operationPerson(context),
            context.clock.now().toISOString(),
          ),
        },
      };
    },
  }),
];
