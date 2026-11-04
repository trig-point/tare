import { orderSchema } from "@tare/order-parser";
import { z as zod } from "zod";
import type { SelectReconcileEmailResult } from "../queries/select-reconcile-email.ts";

const text = zod.string().trim().min(1).max(200);
export const manualOrder = zod.strictObject({
  service: text,
  kind: zod.enum(["scheduling", "processed"]),
  delivery_date: zod.iso.date(),
  meals: zod
    .array(
      zod.strictObject({
        name: text,
        chef: text.nullable(),
        quantity: zod.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(30),
});
export type CompleteOrder = zod.infer<typeof manualOrder>;
const parsed = orderSchema.extend({
  status: zod.literal("parsed"),
  meals: zod.array(
    orderSchema.shape.meals.element.extend({
      source_index: zod.number().int().nonnegative(),
    }),
  ),
  dropped: zod.array(zod.string()),
  uncertain: zod.array(zod.string()),
});

export function readCompleteOrder(
  email: SelectReconcileEmailResult,
): CompleteOrder | null {
  const result = parsed.parse(JSON.parse(email.parse_result ?? "null"));
  if (result.dropped.length || result.uncertain.length) return null;
  const fields = [
    result.service,
    result.kind,
    result.delivery_date,
    ...result.meals.flatMap((meal) => [meal.name, meal.chef, meal.quantity]),
  ];
  if (fields.some((field) => field.uncertain)) return null;
  const complete = manualOrder.safeParse({
    service: email.service,
    kind: result.kind.value,
    delivery_date: result.delivery_date.value,
    meals: result.meals.map((meal) => ({
      name: meal.name.value,
      chef: meal.chef.value,
      quantity: meal.quantity.value,
    })),
  });
  return complete.success ? complete.data : null;
}
