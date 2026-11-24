import type { AlignedData } from "uplot";
import { z } from "zod";
import { api } from "./api.ts";
import { type BodyUnits, weightFromKg } from "./body-units.ts";

export const activityLevels = {
  sedentary: "Sedentary",
  light: "Light",
  moderate: "Moderate",
  active: "Active",
  very_active: "Very active",
} as const;
export const profileSchema = z.object({
  height_cm: z.number(),
  birth_date: z.string(),
  sex: z.enum(["male", "female"]),
  activity_level: z.enum(
    Object.keys(activityLevels) as [keyof typeof activityLevels],
  ),
  goal_rate_kg_week: z.number(),
  protein_factor: z.number(),
});
export type Profile = z.infer<typeof profileSchema>;
export type ProfileValues = Record<keyof Profile, string>;

const unitsSchema = z.object({ units: z.enum(["metric", "imperial"]) });
export const bodyUnitsKey = (person: number) => ["body-units", person] as const;
export async function readBodyUnits(signal: AbortSignal) {
  return unitsSchema.parse(await api("/api/profile/units", { signal })).units;
}
export async function saveBodyUnits(units: BodyUnits, signal?: AbortSignal) {
  return unitsSchema.parse(
    await api("/api/profile/units", {
      method: "POST",
      body: JSON.stringify({ units }),
      signal,
    }),
  ).units;
}

const unitsStorageKey = (person: number) => `tare:body-units:${person}`;

export function cachedBodyUnits(person: number): BodyUnits {
  try {
    return localStorage.getItem(unitsStorageKey(person)) === "imperial"
      ? "imperial"
      : "metric";
  } catch {
    return "metric";
  }
}

export function cacheBodyUnits(person: number, units: BodyUnits) {
  try {
    localStorage.setItem(unitsStorageKey(person), units);
  } catch {
    return;
  }
}

export const profileKey = (person: number) => ["profile", person] as const;
export async function readProfile(signal: AbortSignal) {
  return z
    .object({ profile: profileSchema.nullable() })
    .parse(await api("/api/profile", { signal })).profile;
}
export function profileValues(profile: Profile | null): ProfileValues {
  return {
    height_cm: profile ? String(profile.height_cm) : "",
    birth_date: profile?.birth_date ?? "",
    sex: profile?.sex ?? "",
    activity_level: profile?.activity_level ?? "moderate",
    goal_rate_kg_week: profile ? String(profile.goal_rate_kg_week) : "0",
    protein_factor: profile ? String(profile.protein_factor) : "1.6",
  };
}
export async function saveProfile(
  values: Partial<ProfileValues>,
  method: "POST" | "PATCH" = "POST",
) {
  const schema = method === "PATCH" ? profileSchema.partial() : profileSchema;
  const input = schema.parse({
    ...values,
    height_cm:
      values.height_cm === undefined ? undefined : Number(values.height_cm),
    goal_rate_kg_week:
      values.goal_rate_kg_week === undefined
        ? undefined
        : Number(values.goal_rate_kg_week),
    protein_factor:
      values.protein_factor === undefined
        ? undefined
        : Number(values.protein_factor),
  });
  return z.object({ profile: profileSchema }).parse(
    await api("/api/profile", {
      method,
      body: JSON.stringify(input),
    }),
  ).profile;
}

const historySchema = z.object({
  readings: z.array(
    z.object({
      id: z.number(),
      day: z.string(),
      weight_kg: z.number(),
      note: z.string().nullable(),
    }),
  ),
  days: z.array(
    z.object({
      day: z.string(),
      reading_kg: z.number().nullable(),
      trend_kg: z.number(),
    }),
  ),
});
export type WeightHistory = z.infer<typeof historySchema>;
// Under the today key so every refresh of today after a weight change also refreshes the chart.
export const historyKey = (person: number) =>
  ["today", person, "weight-history"] as const;
export async function readHistory(signal: AbortSignal) {
  return historySchema.parse(await api("/api/weights/history", { signal }));
}
export function chartData(
  history: Pick<WeightHistory, "days">,
  units: BodyUnits = "metric",
): AlignedData {
  return [
    history.days.map((entry) => Date.parse(`${entry.day}T12:00:00Z`) / 1000),
    history.days.map((entry) =>
      entry.reading_kg === null ? null : weightFromKg(entry.reading_kg, units),
    ),
    history.days.map((entry) => weightFromKg(entry.trend_kg, units)),
  ];
}
