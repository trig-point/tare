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
export const logFoodInput = zod
  .strictObject({
    ...common,
    ...claim,
    ...optionalNumbers,
    food_id: zod.number().int().positive().optional(),
    source_food_id: zod.number().int().positive().optional(),
    servings: zod.number().positive().optional(),
    name: text.optional(),
  })
  .superRefine((input, context) => {
    const references =
      Number(input.food_id !== undefined) +
      Number(input.source_food_id !== undefined);
    const valid =
      references > 0
        ? references === 1 &&
          input.servings !== undefined &&
          input.name === undefined &&
          input.source === undefined &&
          !nutrientKeys.some((key) => input[key] !== undefined)
        : input.servings === undefined &&
          input.name !== undefined &&
          nutrientKeys.slice(0, 5).some((key) => input[key] != null);
    if (!valid)
      context.addIssue({ code: "custom", message: "Invalid food input" });
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
    portion_note: text.nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 1);
export const logWeightInput = zod.strictObject({
  client_id: text,
  measured_at: zod.string().optional(),
  weight_kg: zod.number().positive(),
  body_fat_pct: zod.number().min(0).max(100).nullable().optional(),
  source: text.nullable().optional(),
});
export const editWeightInput = zod
  .strictObject({
    ...idInput.shape,
    ...logWeightInput
      .pick({ measured_at: true, weight_kg: true, body_fat_pct: true })
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
  eaten_at: zod.string(),
  day: zod.string(),
  ...nutrientFields,
  provenance: zod.enum(["verified", "label", "estimated"]),
  source: zod.string().nullable(),
  portion_note: zod.string().nullable(),
  created_at: zod.string(),
  updated_at: zod.string(),
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
});
export function numbersFrom(input: Partial<Numbers>): Numbers {
  return Object.fromEntries(
    nutrientKeys.map((key) => [key, input[key] ?? null]),
  ) as Numbers;
}
