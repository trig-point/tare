import { z } from "zod";
import type { Session } from "./api.ts";
import { api } from "./api.ts";
import type { OutboxReplay } from "./outbox-replay.ts";

const nutrient = z.number().nonnegative().nullable();
const total = z.object({
  total: nutrient,
  complete: z.boolean(),
  known_subtotal: z.number(),
});
export const nutrients = [
  "kcal",
  "protein_g",
  "carbs_g",
  "fat_g",
  "fiber_g",
] as const;
export const nutrientLabels = {
  kcal: "Calories",
  protein_g: "Protein (g)",
  carbs_g: "Carbs (g)",
  fat_g: "Fat (g)",
  fiber_g: "Fiber (g)",
};
export const intakeSchema = z.object({
  id: z.number().int().positive(),
  client_id: z.string(),
  name: z.string().nullable(),
  food_id: z.number().nullable(),
  source_food_id: z.number().nullable(),
  servings: z.number().nullable(),
  eaten_at: z.string(),
  provenance: z.enum(["verified", "label", "estimated"]),
  source: z.string().nullable(),
  kcal: nutrient,
  protein_g: nutrient,
  carbs_g: nutrient,
  fat_g: nutrient,
  fiber_g: nutrient,
});
export const weightSchema = z.object({
  id: z.number().int().positive(),
  client_id: z.string(),
  weight_kg: z.number().positive(),
  measured_at: z.string(),
  source: z.string().nullable(),
});
export type Weight = z.infer<typeof weightSchema>;
export const todaySchema = z.object({
  day: z.string(),
  entries: z.array(intakeSchema),
  weights: z.array(weightSchema),
  totals: z.object({
    kcal: total,
    protein_g: total,
    carbs_g: total,
    fat_g: total,
    fiber_g: total,
  }),
});
export type Intake = z.infer<typeof intakeSchema>;
export const todayKey = (person: number) => ["today", person] as const;
export async function readToday(signal: AbortSignal) {
  return todaySchema.parse(await api("/api/today", { signal }));
}
export function totalText(value: z.infer<typeof total>) {
  return value.complete && value.total !== null
    ? String(value.total)
    : `${value.known_subtotal} + Incomplete`;
}
export async function changeIntake(
  id: number,
  changes?: Record<string, unknown>,
) {
  const response = await api(
    `/api/intake/${id}`,
    changes
      ? { method: "PATCH", body: JSON.stringify(changes) }
      : { method: "DELETE" },
  );
  if (changes) z.object({ entry: intakeSchema }).parse(response);
  else
    z.object({ deleted: z.literal(true), id: z.literal(id) }).parse(response);
}

export async function changeWeight(
  id: number,
  changes?: Record<string, unknown>,
) {
  const response = await api(
    `/api/weights/${id}`,
    changes
      ? { method: "PATCH", body: JSON.stringify(changes) }
      : { method: "DELETE" },
  );
  if (changes) z.object({ entry: weightSchema }).parse(response);
  else
    z.object({ deleted: z.literal(true), id: z.literal(id) }).parse(response);
}

export async function enqueueWeight(
  replay: OutboxReplay,
  person: Session["user"],
  weight: string,
) {
  const value = Number(weight);
  if (!weight.trim() || !Number.isFinite(value) || value <= 0)
    throw new Error("Invalid weight");
  await replay.enqueue(
    "weight",
    { weight_kg: value, measured_at: new Date().toISOString() },
    person,
  );
}
