import type { AlignedData } from "uplot";
import { z } from "zod";
import { api } from "./api.ts";

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
export async function saveProfile(values: ProfileValues) {
  const input = profileSchema.parse({
    ...values,
    height_cm: Number(values.height_cm),
    goal_rate_kg_week: Number(values.goal_rate_kg_week),
    protein_factor: Number(values.protein_factor),
  });
  return z.object({ profile: profileSchema }).parse(
    await api("/api/profile", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  ).profile;
}

const historySchema = z.object({
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
export function chartData(history: WeightHistory): AlignedData {
  return [
    history.days.map((entry) => Date.parse(`${entry.day}T12:00:00Z`) / 1000),
    history.days.map((entry) => entry.reading_kg),
    history.days.map((entry) => entry.trend_kg),
  ];
}
