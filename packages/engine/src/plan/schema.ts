import { z as zod } from "zod";
import { OperationError } from "../operations/registry.ts";

export const identifier = zod.number().int().positive();
export const planSlotInput = zod
  .strictObject({
    position: zod.number().int().nonnegative(),
    meal_id: identifier.optional(),
    food_id: identifier.optional(),
    servings: zod.number().positive().optional(),
    item_id: identifier.optional(),
    revision: identifier.optional(),
  })
  .refine(
    (input) =>
      (input.meal_id === undefined) !== (input.food_id === undefined) &&
      (input.meal_id === undefined || input.servings === undefined) &&
      (input.item_id === undefined) === (input.revision === undefined),
  );
export const plannedItemSchema = zod.strictObject({
  id: identifier,
  revision: identifier,
  state: zod.enum(["planned", "eaten", "skipped"]),
  template_id: identifier,
  position: zod.number().int().nonnegative(),
  reference: zod.strictObject({
    kind: zod.enum(["meal", "food"]),
    id: identifier,
    name: zod.string(),
  }),
  servings: zod.number().positive().nullable(),
  nutrition: zod.strictObject({
    status: zod.enum(["known", "pending", "unknown"]),
  }),
});
const name = zod
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.includes("\u0000"));
const minute = zod.number().int().min(0).max(1440);
const slotInput = zod
  .strictObject({
    name,
    start_minute: minute.describe(
      "Wall-clock minutes after the person's day start.",
    ),
    end_minute: minute,
    share: zod
      .number()
      .multipleOf(0.01)
      .describe(
        "Percent with up to two decimals; stored as integer basis points (100 percent = 10000).",
      ),
    fill_hint: zod.string().max(200).nullable().optional(),
  })
  .refine((slot) => slot.start_minute < slot.end_minute);
const slots = zod.array(slotInput).min(1);

const saveFields = {
  action: zod.enum(["create", "update", "delete"]),
  id: identifier.optional(),
  name: name.optional(),
};
function validSave(input: { action: string; id?: number }, complete: boolean) {
  return (
    (input.action === "create"
      ? input.id === undefined
      : input.id !== undefined) &&
    (input.action === "delete" || complete)
  );
}
export const saveTemplateInput = zod
  .strictObject({ ...saveFields, slots: slots.optional() })
  .refine((input) =>
    validSave(input, input.name !== undefined && input.slots !== undefined),
  );
export const saveTypeInput = zod
  .strictObject({ ...saveFields, template_id: identifier.optional() })
  .refine((input) =>
    validSave(
      input,
      input.name !== undefined && input.template_id !== undefined,
    ),
  );
const validSlots = slots.superRefine((values, context) => {
  const reject = (message: string) =>
    context.addIssue({ code: "custom", message });
  if (values.some((slot) => slot.share <= 0)) reject("invalid_template_share");
  if (
    values.reduce((total, slot) => total + Math.round(slot.share * 100), 0) !==
    10000
  )
    reject("invalid_template_shares");
  const ordered = values.toSorted(
    (left, right) => left.start_minute - right.start_minute,
  );
  let previousEnd = 0;
  for (const slot of ordered) {
    if (slot.start_minute < previousEnd) reject("slot_windows_overlap");
    previousEnd = slot.end_minute;
  }
});
export function validateSlots(values: zod.infer<typeof slots>) {
  const result = validSlots.safeParse(values);
  if (!result.success)
    throw new OperationError(
      400,
      result.error.issues[0]?.message ?? "invalid_request",
    );
}

export const templateSchema = zod.strictObject({
  id: identifier,
  user_id: identifier,
  name: zod.string(),
  created_at: zod.string(),
});
export const dayTypeSchema = zod.strictObject({
  id: identifier,
  user_id: identifier,
  name: zod.string(),
  template_id: identifier,
});
export const slotSchema = zod.strictObject({
  user_id: identifier,
  template_id: identifier,
  position: zod.number().int().nonnegative(),
  name: zod.string(),
  start_minute: minute,
  end_minute: minute,
  share_bp: zod.number().int().positive(),
  fill_hint: zod.string().nullable(),
});
export const budgetStatus = zod.enum([
  "ready",
  "no_day_type",
  "needs_profile",
  "needs_weigh_in",
]);
const nutrientBudget = zod.strictObject({
  intake: zod.number().int().nullable(),
  known_subtotal: zod.number().int(),
  complete: zod.boolean(),
  budget: zod.number().int().nullable(),
  remaining: zod.number().int().nullable(),
});
export const slotBudgetSchema = zod.strictObject({
  template_id: identifier,
  position: zod.number().int().nonnegative(),
  name: zod.string(),
  window_start: minute,
  window_end: minute,
  ended: zod.boolean(),
  kcal: nutrientBudget,
  protein_g: nutrientBudget,
});
export const budgetsSchema = zod.strictObject({
  status: budgetStatus,
  target: zod
    .strictObject({ kcal: zod.number(), protein_g: zod.number() })
    .nullable(),
  slots: zod.array(slotBudgetSchema),
});
export const planSchema = zod
  .strictObject({
    status: zod.enum(["ready", "no_day_type"]),
    day: zod.iso.date(),
    day_type: dayTypeSchema.nullable(),
    template: templateSchema.nullable(),
    slots: zod.array(slotSchema),
    budgets: budgetsSchema,
  })
  .refine((plan) =>
    plan.status === "ready"
      ? plan.day_type !== null &&
        plan.template !== null &&
        plan.slots.length > 0
      : plan.day_type === null &&
        plan.template === null &&
        plan.slots.length === 0,
  );
