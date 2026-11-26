import { z } from "zod";

export const foodChoiceFields = {
  eating_out_default: z.boolean().optional(),
  can_tag_eating_out: z.boolean().optional(),
};

export type Choice = {
  eating_out_default?: boolean | undefined;
  can_tag_eating_out?: boolean | undefined;
};

export function eatingOutOverride(food: Choice, checked: boolean | undefined) {
  if (checked === undefined || checked === (food.eating_out_default ?? false))
    return undefined;
  if (checked && !food.can_tag_eating_out) return undefined;
  return checked;
}
