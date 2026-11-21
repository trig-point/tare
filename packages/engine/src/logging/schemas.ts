import { z as zod } from "zod";
import { OperationError } from "../operations/registry.ts";

const text = zod.string().trim().min(1);
const nutrient = zod.number().nonnegative().nullable();
export const nutrientFields = {
  kcal: nutrient,
  protein_g: nutrient,
  carbs_g: nutrient,
  fat_g: nutrient,
  fiber_g: nutrient,
  kcal_low: nutrient,
  kcal_high: nutrient,
};
export const nutrientKeys = Object.keys(
  nutrientFields,
) as (keyof typeof nutrientFields)[];
export type Numbers = { [Key in keyof typeof nutrientFields]: number | null };
export function validateNumbers(numbers: Numbers) {
  const { kcal, kcal_low, kcal_high } = numbers;
  if (
    (kcal_low === null) !== (kcal_high === null) ||
    (kcal_low !== null &&
      kcal_high !== null &&
      (kcal_low > kcal_high ||
        (kcal !== null && (kcal < kcal_low || kcal > kcal_high))))
  )
    throw new OperationError(400, "invalid_bounds");
  if (!nutrientKeys.slice(0, 5).some((key) => numbers[key] !== null))
    throw new OperationError(400, "invalid_request");
  if (
    nutrientKeys.some(
      (key) =>
        numbers[key] !== null &&
        (!Number.isFinite(numbers[key]) || numbers[key] < 0),
    )
  )
    throw new OperationError(400, "invalid_request");
}
const optionalNumbers = zod.object(nutrientFields).partial().shape;
const claim = {
  provenance: zod.enum(["verified", "label", "estimated"]).optional(),
  source: text.nullable().optional(),
};
const common = {
  client_id: text,
  eaten_at: zod.string().optional(),
  portion_note: text.nullable().optional(),
};
const servingBounds = {
  servings_low: zod.number().positive().optional(),
  servings_high: zod.number().positive().optional(),
};
export const logFoodInput = zod
  .strictObject({
    ...common,
    ...claim,
    ...optionalNumbers,
    food_id: zod.number().int().positive().optional(),
    source_food_id: zod.number().int().positive().optional(),
    servings: zod.number().positive().optional(),
    amount_estimated: zod.literal(true).optional(),
    ...servingBounds,
    name: text.optional(),
  })
  .superRefine((input, context) => {
    const references =
      Number(input.food_id !== undefined) +
      Number(input.source_food_id !== undefined);
    if (
      (input.amount_estimated &&
        (references !== 1 || input.provenance !== undefined)) ||
      (!input.amount_estimated &&
        (input.servings_low !== undefined || input.servings_high !== undefined))
    )
      context.addIssue({
        code: "custom",
        message: input.amount_estimated
          ? "An estimated amount needs a food reference and no provenance"
          : "servings_low and servings_high need amount_estimated: true",
      });
    if (references === 0 && input.servings !== undefined)
      context.addIssue({
        code: "custom",
        message: "Servings needs a food reference",
      });
    if (references > 0) {
      if (references !== 1 || input.servings === undefined)
        context.addIssue({
          code: "custom",
          message: "Use one food reference with servings",
        });
      if (
        input.name !== undefined ||
        input.source !== undefined ||
        nutrientKeys.some((key) => input[key] !== undefined)
      )
        context.addIssue({
          code: "custom",
          message: "A food reference takes no name, source or nutrients",
        });
    } else if (
      input.name === undefined ||
      !nutrientKeys.slice(0, 5).some((key) => input[key] != null)
    )
      context.addIssue({
        code: "custom",
        message:
          "Ad hoc food needs a name and one of kcal, protein, carbs, fat or fiber",
      });
  });
export const idInput = zod.strictObject({
  id: zod.coerce.number().int().positive(),
});
export const editIntakeInput = zod
  .strictObject({
    ...idInput.shape,
    ...optionalNumbers,
    ...claim,
    name: text.optional(),
    eaten_at: zod.string().optional(),
    servings: zod.number().positive().optional(),
    amount_measured: zod.literal(true).optional(),
    ...servingBounds,
    portion_note: text.nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 1);
export const logWeightInput = zod.strictObject({
  client_id: text,
  measured_at: zod.string().optional(),
  weight_kg: zod.number().positive(),
  body_fat_pct: zod.number().min(0).max(100).nullable().optional(),
  source: text.nullable().optional(),
  note: zod
    .string()
    .max(200)
    .refine((note) => !note.includes("\0") && !/[\uD800-\uDFFF]/u.test(note))
    .nullable()
    .optional(),
});
export const editWeightInput = zod
  .strictObject({
    ...idInput.shape,
    ...logWeightInput
      .pick({
        measured_at: true,
        weight_kg: true,
        body_fat_pct: true,
        note: true,
      })
      .partial().shape,
  })
  .refine((input) => Object.keys(input).length > 1);
export const intakeRow = zod.strictObject({
  id: zod.number(),
  user_id: zod.number(),
  client_id: zod.string(),
  name: zod.string().nullable(),
  food_id: zod.number().nullable(),
  source_food_id: zod.number().nullable(),
  servings: zod.number().nullable(),
  amount_estimated: zod.union([zod.literal(0), zod.literal(1)]).default(0),
  servings_low: zod.number().nullable().default(null),
  servings_high: zod.number().nullable().default(null),
  eaten_at: zod.string(),
  day: zod.string(),
  ...nutrientFields,
  provenance: zod.enum(["verified", "label", "estimated"]),
  source: zod.string().nullable(),
  portion_note: zod.string().nullable(),
  created_at: zod.string(),
  updated_at: zod.string(),
  slot_template_id: zod.number().nullable().optional(),
  slot_position: zod.number().nullable().optional(),
});
export const weightRow = zod.strictObject({
  id: zod.number(),
  user_id: zod.number(),
  client_id: zod.string(),
  measured_at: zod.string(),
  day: zod.string(),
  weight_kg: zod.number(),
  body_fat_pct: zod.number().nullable(),
  source: zod.string().nullable(),
  created_at: zod.string(),
  note: zod.string().nullable(),
});
export function numbersFrom(input: Partial<Numbers>): Numbers {
  return Object.fromEntries(
    nutrientKeys.map((key) => [key, input[key] ?? null]),
  ) as Numbers;
}
