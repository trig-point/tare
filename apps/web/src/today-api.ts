import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Session } from "./api.ts";
import { api } from "./api.ts";
import type { OutboxReplay, QueueSnapshot } from "./outbox-replay.ts";
import { planKey } from "./plan-api.ts";

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
  kcal_low: nutrient,
  kcal_high: nutrient,
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
  body_fat_pct: z.number().nullable(),
  measured_at: z.string(),
  source: z.string().nullable(),
});
export type Weight = z.infer<typeof weightSchema>;
const adaptive = z.object({ status: z.enum(["eligible", "learning"]) });
export const targetSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    kcal: z.number(),
    protein_g: z.number(),
    basis: z.enum(["weekly_adaptive", "weekly_formula", "live_formula"]),
    adaptive,
  }),
  z.object({ status: z.enum(["needs_profile", "needs_weigh_in"]), adaptive }),
]);
export const todaySchema = z.object({
  day: z.string(),
  timezone: z.string(),
  entries: z.array(intakeSchema),
  weights: z.array(weightSchema),
  totals: z.object({
    kcal: total,
    protein_g: total,
    carbs_g: total,
    fat_g: total,
    fiber_g: total,
  }),
  target: targetSchema,
  target_notice: z
    .object({
      id: z.number().int().positive(),
      old_kcal: z.number(),
      old_protein_g: z.number(),
      new_kcal: z.number(),
      new_protein_g: z.number(),
    })
    .nullable(),
  remaining: z.object({
    kcal: z.number().nullable(),
    protein_g: z.number().nullable(),
  }),
});
export type TodayData = z.infer<typeof todaySchema>;
export type Intake = z.infer<typeof intakeSchema>;
export const todayKey = (person: number) => ["today", person] as const;
export async function readToday(signal: AbortSignal) {
  return todaySchema.parse(await api("/api/today", { signal }));
}
export function totalText(value: z.infer<typeof total>) {
  return value.complete && value.total !== null
    ? displayNumber(value.total)
    : `${displayNumber(value.known_subtotal)} + Incomplete`;
}
export async function dismissTargetNotice(id: number) {
  z.object({ id: z.literal(id) }).parse(
    await api("/api/target-notice/dismiss", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  );
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

export function settledSince(
  previousPending: Set<string>,
  snapshot: QueueSnapshot,
  personId: number,
) {
  if (snapshot.type !== "ready")
    return { pending: previousPending, settled: false };
  const pending = new Set(
    snapshot.records
      .filter(
        (entry) => entry.person_id === personId && entry.state === "pending",
      )
      .map((entry) => entry.client_id),
  );
  return {
    pending,
    settled: [...previousPending].some((clientId) => !pending.has(clientId)),
  };
}
export function intakeChanges(entry: Intake, values: Record<string, string>) {
  const changes: Record<string, unknown> = {};
  for (const key of nutrients) {
    const value = values[key] === "" ? null : Number(values[key]);
    if (value !== entry[key]) changes[key] = value;
  }
  if (Object.keys(changes).length === 0) return changes;
  if (entry.provenance === "label")
    Object.assign(changes, { provenance: "label", source: entry.source });
  const kcal = changes.kcal;
  if (
    typeof kcal === "number" &&
    ((entry.kcal_low !== null && kcal < entry.kcal_low) ||
      (entry.kcal_high !== null && kcal > entry.kcal_high))
  )
    Object.assign(changes, { kcal_low: null, kcal_high: null });
  return changes;
}
export function displayNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
    value,
  );
}
export function sourceName(source: string) {
  return source === "usda"
    ? "USDA"
    : source === "off"
      ? "Open Food Facts"
      : source;
}

export async function refreshToday(client: QueryClient, personId: number) {
  const queryKey = todayKey(personId);
  await client.cancelQueries({ queryKey });
  await Promise.all([
    client.invalidateQueries({ queryKey }),
    client.invalidateQueries({ queryKey: planKey(personId) }),
    client.invalidateQueries({ queryKey: ["signals", personId] }),
  ]);
}
