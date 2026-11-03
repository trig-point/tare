import { z as zod } from "zod";
import { writeTransaction } from "../db.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { selectOrder } from "../queries/orders/select-order.ts";
import { listMealsOnHand, recordDelivery } from "./index.ts";

const shared = {
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser_and_agent",
  admin: false,
} as const;

export const orderOperations = [
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
