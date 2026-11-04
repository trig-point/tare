import { orderSchema } from "@tare/order-parser";
import { z as zod } from "zod";
import { OperationError } from "../operations/registry.ts";
import type { SelectReconcileEmailResult } from "../queries/select-reconcile-email.ts";

const text = zod.string().trim().min(1).max(200);
const quantity = zod.number().int().nonnegative();
const kind = zod.enum(["scheduling", "processed"]);
const meal = zod.strictObject({ name: text, chef: text.nullable(), quantity });
export const manualOrder = zod.strictObject({
  service: text,
  kind,
  delivery_date: zod.iso.date().nullable(),
  meals: zod.array(meal).min(1).max(30),
});
const draft = manualOrder.extend({
  service: text.nullable(),
  kind: kind.nullable(),
  meals: zod
    .array(
      meal.extend({
        quantity: quantity.nullable(),
        source_index: zod.number().int().nonnegative(),
      }),
    )
    .max(30),
  issues: zod.array(zod.string()),
  resolved: zod.array(zod.string()),
});
export type OrderDraft = zod.infer<typeof draft>;
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
const fullMeal = meal.extend({ chef: text.nullable().optional() });
export const corrections = zod.strictObject({
  service: text.optional(),
  kind: kind.optional(),
  delivery_date: zod.iso.date().optional(),
  meals: zod
    .union([
      zod.array(fullMeal).min(1).max(30),
      zod
        .array(
          zod.strictObject({
            source_index: zod.number().int().nonnegative(),
            name: text.optional(),
            chef: text.nullable().optional(),
            quantity: quantity.optional(),
          }),
        )
        .min(1)
        .max(30),
    ])
    .optional(),
});

export const dateAnswer = zod.strictObject({ delivery_date: zod.iso.date() });
export const lateAnswer = zod.strictObject({
  action: zod.enum(["accept", "ignore"]),
});
export const advisoryAnswer = zod.union([
  zod.strictObject({ confirm: zod.literal(true) }),
  zod.strictObject({ corrections }),
]);
export const reviewAnswer = zod.union([corrections, advisoryAnswer]);

export function readOrderDraft(email: SelectReconcileEmailResult): OrderDraft {
  const result = parsed.parse(JSON.parse(email.parse_result ?? "null"));
  if (email.manual_result !== null) {
    const saved: unknown = JSON.parse(email.manual_result);
    const partial = zod.strictObject({ partial: draft }).safeParse(saved);
    if (partial.success) return partial.data.partial;
    const manual = manualOrder.parse(saved);
    return {
      ...manual,
      issues: [],
      resolved: [],
      meals: manual.meals.map((meal, index) => ({
        ...meal,
        source_index: result.meals[index]?.source_index ?? index,
      })),
    };
  }
  return {
    service: email.service ?? result.service.value,
    kind: result.kind.value,
    delivery_date: result.delivery_date.value,
    meals: result.meals.map((meal) => ({
      name: text.parse(meal.name.value),
      chef: meal.chef.value,
      quantity: meal.quantity.value,
      source_index: meal.source_index,
    })),
    issues: [...new Set([...result.dropped, ...result.uncertain])].filter(
      (path) => path !== "service" || email.service === null,
    ),
    resolved: [],
  };
}

export function foldAnswer(
  email: SelectReconcileEmailResult,
  input: zod.infer<typeof corrections>,
): OrderDraft {
  const result = readOrderDraft(email);
  if (
    email.service !== null &&
    input.service !== undefined &&
    input.service !== email.service
  )
    throw new OperationError(400, "invalid_answer");
  for (const field of ["service", "kind", "delivery_date"] as const) {
    if (input[field] === undefined) continue;
    Object.assign(result, { [field]: input[field] });
    result.issues = result.issues.filter((path) => path !== field);
  }
  if (input.meals) {
    if (input.meals.every((meal) => !("source_index" in meal))) {
      result.meals = zod
        .array(fullMeal)
        .parse(input.meals)
        .map((meal, index) => ({
          ...meal,
          chef: meal.chef ?? null,
          source_index: index,
        }));
      result.issues = result.issues.filter(
        (path) => !path.startsWith("meals["),
      );
      result.resolved = result.meals.map(
        (meal) => `meals[${meal.source_index}].chef`,
      );
    } else {
      for (const fix of input.meals) {
        if (!("source_index" in fix))
          throw new OperationError(400, "invalid_answer");
        const target = result.meals.find(
          (meal) => meal.source_index === fix.source_index,
        );
        if (!target) throw new OperationError(400, "invalid_answer");
        for (const field of ["name", "chef", "quantity"] as const) {
          if (fix[field] === undefined) continue;
          Object.assign(target, { [field]: fix[field] });
          const path = `meals[${fix.source_index}]${field === "name" ? "" : `.${field}`}`;
          result.issues = result.issues.filter((issue) => issue !== path);
          result.resolved.push(path);
        }
      }
    }
  }
  return result;
}

export function normalizedOrder(input: OrderDraft) {
  return manualOrder.parse({
    service: input.service,
    kind: input.kind,
    delivery_date: input.delivery_date,
    meals: input.meals.map(({ name, chef, quantity }) => ({
      name,
      chef,
      quantity,
    })),
  });
}
