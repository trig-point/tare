import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import type { Person } from "../auth/middleware.ts";
import type { TdeeSettings } from "../config.ts";
import { localDay } from "../logging/day.ts";
import { profileSchema } from "../profile/schema.ts";
import { selectProfile } from "../queries/select-profile.ts";
import { selectTargetWeights } from "../queries/select-target-weights.ts";
import { weightTrend } from "../trend/weight-trend.ts";
import { adaptiveSchema, readAdaptive } from "./adaptive.ts";
import { ageYears, formulaTarget } from "./formula.ts";

export const targetSchema = zod.discriminatedUnion("status", [
  zod.strictObject({
    status: zod.literal("ready"),
    kcal: zod.number(),
    protein_g: zod.number(),
    trend_kg: zod.number(),
    adaptive: adaptiveSchema,
  }),
  zod.strictObject({
    status: zod.literal("needs_profile"),
    adaptive: adaptiveSchema,
  }),
  zod.strictObject({
    status: zod.literal("needs_weigh_in"),
    adaptive: adaptiveSchema,
  }),
]);

export function readTarget(
  database: Database,
  person: Person,
  now: Date,
  settings: TdeeSettings,
): zod.infer<typeof targetSchema> {
  const today = localDay(
    now.toISOString(),
    person.timezone,
    person.day_start_hour,
  );
  const stored = selectProfile(database, { user_id: person.id });
  const adaptive = readAdaptive(database, person, now, settings);
  if (!stored) return { status: "needs_profile", adaptive };
  const profile = profileSchema.parse(stored);
  const trend = weightTrend(
    selectTargetWeights(database, { user_id: person.id, day: today }),
  ).at(-1);
  if (!trend) return { status: "needs_weigh_in", adaptive };
  const target = formulaTarget({
    trendKg: trend.trend_kg,
    heightCm: profile.height_cm,
    ageYears: ageYears(profile.birth_date, today),
    sex: profile.sex,
    activityLevel: profile.activity_level,
    goalRateKgWeek: profile.goal_rate_kg_week,
    proteinFactor: profile.protein_factor,
  });
  return {
    status: "ready",
    kcal: target.kcal,
    protein_g: target.protein_g,
    trend_kg: trend.trend_kg,
    adaptive,
  };
}
