import { z as zod } from "zod";

const units = zod.enum(["metric", "imperial"]);

export const profileInput = zod.strictObject({
  height_cm: zod.number().min(100).max(250),
  birth_date: zod.iso.date(),
  sex: zod.enum(["male", "female"]),
  activity_level: zod.enum([
    "sedentary",
    "light",
    "moderate",
    "active",
    "very_active",
  ]),
  goal_rate_kg_week: zod.number().min(-1.5).max(1),
  units: units.optional(),
  protein_factor: zod.number().min(0.8).max(3).default(1.6),
});
export const profileSchema = profileInput.extend({
  units,
  user_id: zod.number().int(),
  updated_at: zod.iso.datetime(),
});
