import type { Database } from "better-sqlite3";
import type { Person } from "../auth/middleware.ts";
import { localDay } from "../logging/day.ts";
import { profileSchema } from "../profile/schema.ts";
import { selectProfile } from "../queries/select-profile.ts";
import { selectTargetWeights } from "../queries/select-target-weights.ts";
import { weightTrend } from "../trend/weight-trend.ts";
import { ageYears, formulaTarget } from "./formula.ts";

export function liveFormula(database: Database, person: Person, now: Date) {
  const today = localDay(
    now.toISOString(),
    person.timezone,
    person.day_start_hour,
  );
  const stored = selectProfile(database, { user_id: person.id });
  if (!stored) return { status: "needs_profile" } as const;
  const profile = profileSchema.parse(stored);
  const trend = weightTrend(
    selectTargetWeights(database, { user_id: person.id, day: today }),
  ).at(-1);
  if (!trend) return { status: "needs_weigh_in" } as const;
  return {
    status: "ready",
    profile,
    trend_kg: trend.trend_kg,
    ...formulaTarget({
      trendKg: trend.trend_kg,
      heightCm: profile.height_cm,
      ageYears: ageYears(profile.birth_date, today),
      sex: profile.sex,
      activityLevel: profile.activity_level,
      goalRateKgWeek: profile.goal_rate_kg_week,
      proteinFactor: profile.protein_factor,
    }),
  } as const;
}
