import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import type { Person } from "../auth/middleware.ts";
import type { TdeeSettings } from "../config.ts";
import { localDay } from "../logging/day.ts";
import { selectAdaptiveDays } from "../queries/select-adaptive-days.ts";
import {
  type SelectAdaptiveIntakeResult,
  selectAdaptiveIntake,
} from "../queries/select-adaptive-intake.ts";
import { selectTargetWeights } from "../queries/select-target-weights.ts";
import { type WeightTrendDay, weightTrend } from "../trend/weight-trend.ts";

const counts = {
  signed_days: zod.number().int().nonnegative(),
  weigh_in_days: zod.number().int().nonnegative(),
  span_days: zod.number().int().nonnegative().nullable(),
};
export const adaptiveSchema = zod.discriminatedUnion("status", [
  zod.strictObject({
    status: zod.literal("eligible"),
    ...counts,
    span_days: zod.number().int().positive(),
    tdee_kcal: zod.number(),
    low_kcal: zod.number(),
    high_kcal: zod.number(),
    mean_intake_kcal: zod.number(),
    weight_rate_kg_per_day: zod.number(),
  }),
  zod.strictObject({
    status: zod.literal("learning"),
    reason: zod.enum([
      "incomplete_intake",
      "signed_days",
      "weigh_in_days",
      "span",
    ]),
    ...counts,
  }),
]);

interface AdaptiveInput {
  start: string;
  end: string;
  signedDays: readonly { day: string }[];
  intake: readonly SelectAdaptiveIntakeResult[];
  trend: readonly WeightTrendDay[];
}

function shiftedDay(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function computeAdaptive(
  input: AdaptiveInput,
  settings: TdeeSettings,
): zod.infer<typeof adaptiveSchema> {
  const signed = new Set(
    input.signedDays
      .map(({ day }) => day)
      .filter((day) => day >= input.start && day <= input.end),
  );
  const intake = input.intake.filter(({ day }) => signed.has(day));
  const trend = input.trend.filter(({ day }) => day <= input.end);
  const anchor = shiftedDay(input.start, -1);
  const prior = trend.findLast(({ day }) => day <= anchor);
  const first = prior ?? trend.find(({ day }) => day >= input.start);
  const final = trend.at(-1);
  const spanStart = prior ? anchor : first?.day;
  const span =
    spanStart === undefined
      ? null
      : (Date.parse(input.end) - Date.parse(spanStart)) / 86_400_000;
  const resultCounts = {
    signed_days: signed.size,
    weigh_in_days: new Set(
      trend
        .filter(
          ({ day, reading_kg }) => day >= input.start && reading_kg !== null,
        )
        .map(({ day }) => day),
    ).size,
    span_days: span,
  };
  const reason = intake.some(({ kcal }) => kcal === null)
    ? "incomplete_intake"
    : signed.size < settings.minSignedDays
      ? "signed_days"
      : resultCounts.weigh_in_days < settings.minWeighInDays
        ? "weigh_in_days"
        : span === null || span < settings.minSpanDays
          ? "span"
          : null;
  if (reason !== null) return { status: "learning", reason, ...resultCounts };
  if (!first || !final || span === null || span <= 0)
    throw new Error("Eligible adaptive estimate requires a weight span");
  let total = 0;
  let low = 0;
  let high = 0;
  for (const entry of intake) {
    if (entry.kcal === null)
      throw new Error("Eligible adaptive estimate requires complete intake");
    total += entry.kcal;
    low +=
      entry.provenance === "estimated"
        ? (entry.kcal_low ?? entry.kcal * (1 - settings.defaultRange))
        : entry.kcal;
    high +=
      entry.provenance === "estimated"
        ? (entry.kcal_high ?? entry.kcal * (1 + settings.defaultRange))
        : entry.kcal;
  }
  const rate = (final.trend_kg - first.trend_kg) / span;
  const adjustment = rate * settings.energyDensity;
  return {
    status: "eligible",
    ...resultCounts,
    span_days: span,
    tdee_kcal: total / signed.size - adjustment,
    low_kcal: low / signed.size - adjustment,
    high_kcal: high / signed.size - adjustment,
    mean_intake_kcal: total / signed.size,
    weight_rate_kg_per_day: rate,
  };
}

export function readAdaptive(
  database: Database,
  person: Person,
  now: Date,
  settings: TdeeSettings,
): zod.infer<typeof adaptiveSchema> {
  const end = shiftedDay(
    localDay(now.toISOString(), person.timezone, person.day_start_hour),
    -1,
  );
  const start = shiftedDay(end, 1 - settings.windowDays);
  const params = { user_id: person.id, start, end };
  return computeAdaptive(
    {
      start,
      end,
      signedDays: selectAdaptiveDays(database, params),
      intake: selectAdaptiveIntake(database, params),
      trend: weightTrend(
        selectTargetWeights(database, { user_id: person.id, day: end }),
      ),
    },
    settings,
  );
}
