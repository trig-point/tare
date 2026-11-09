import type { ActivityCategory } from "../signals/activity-kinds.ts";
import type { WeightTrendDay } from "./weight-trend.ts";

export interface BodyFatReading {
  id: number;
  day: string;
  measured_at: string;
  body_fat_pct: number;
}
export interface TrendWorkout {
  timing: string;
  started_at: string | null;
  duration_minutes: number | null;
  day: string;
  category: ActivityCategory;
}

const windowDays = 28;
const minimumReadings = 8;
const scaleErrorPoints = 2;
const postWorkoutMs = 12 * 3_600_000;
const strengthLookbackDays = 21;
const excludingCategories = new Set<ActivityCategory>([
  "strength",
  "cardio",
  "sauna",
]);

export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const oneDecimal = (value: number) => Math.round(value * 10) / 10;
function median(values: number[]): number {
  const sorted = values.toSorted((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function workoutEnds(workouts: readonly TrendWorkout[]): number[] {
  return workouts.flatMap((workout) =>
    workout.timing === "exact" &&
    workout.started_at !== null &&
    workout.duration_minutes !== null &&
    excludingCategories.has(workout.category)
      ? [Date.parse(workout.started_at) + workout.duration_minutes * 60_000]
      : [],
  );
}

function trendAt(weights: readonly WeightTrendDay[], day: string) {
  return weights.findLast((entry) => entry.day <= day)?.trend_kg;
}

function trainingSentence(count: number) {
  if (count === 0) return "No strength sessions logged in 3 weeks.";
  return `${count} strength session${count === 1 ? "" : "s"} logged in 3 weeks.`;
}
function weightSentence(change: number) {
  const rounded = oneDecimal(change);
  if (rounded === 0) return "Weight unchanged.";
  return `Weight ${rounded > 0 ? "up" : "down"} ${Math.abs(rounded)} kg.`;
}
function bodyFatSentence(change: number, withinError: boolean) {
  const size = Math.abs(change);
  const tail = withinError ? ", within this scale's error." : ".";
  if (size === 0) return `Body fat reading unchanged${tail}`;
  const unit = size === 1 ? "point" : "points";
  return `Body fat reading ${change > 0 ? "up" : "down"} ${size} ${unit}${tail}`;
}

/** Readings must be ordered by day, measured_at and id. */
export function bodyFatTrend(input: {
  readings: readonly BodyFatReading[];
  workouts: readonly TrendWorkout[];
  weights: readonly WeightTrendDay[];
  today: string;
}) {
  const ends = workoutEnds(input.workouts);
  const seenDays = new Set<string>();
  const readings = input.readings.map((reading) => {
    const measured = Date.parse(reading.measured_at);
    const afterWorkout = ends.some(
      (end) => measured >= end && measured - end <= postWorkoutMs,
    );
    const firstOfDay = !seenDays.has(reading.day);
    seenDays.add(reading.day);
    return {
      ...reading,
      after_workout: afterWorkout,
      in_trend: firstOfDay && !afterWorkout,
    };
  });
  if (readings.length === 0) return { readings, trend: null };

  const currentStart = shiftDay(input.today, 1 - windowDays);
  const priorStart = shiftDay(currentStart, -windowDays);
  const inWindow = (from: string, to: string) =>
    readings
      .filter(
        (reading) =>
          reading.in_trend && reading.day >= from && reading.day <= to,
      )
      .map((reading) => reading.body_fat_pct);
  const current = inWindow(currentStart, input.today);
  const prior = inWindow(priorStart, shiftDay(currentStart, -1));
  if (current.length < minimumReadings || prior.length < minimumReadings)
    return {
      readings,
      trend: {
        status: "not_enough" as const,
        current_count: current.length,
        prior_count: prior.length,
        lines: [
          "Not enough readings for a trend",
          current.length < minimumReadings
            ? `${current.length} of ${minimumReadings} readings in the last 4 weeks`
            : `${prior.length} of ${minimumReadings} readings in the 4 weeks before`,
        ],
      },
    };

  const level = median(current);
  const change = oneDecimal(level - median(prior));
  const withinError = Math.abs(change) < scaleErrorPoints;
  const strengthFrom = shiftDay(input.today, 1 - strengthLookbackDays);
  const strengthCount = input.workouts.filter(
    (workout) =>
      workout.category === "strength" &&
      workout.day >= strengthFrom &&
      workout.day <= input.today,
  ).length;
  const weightEnd = trendAt(input.weights, input.today);
  const weightStart = trendAt(input.weights, shiftDay(currentStart, -1));
  // Every body fat reading is a weigh-in, so the prior window guarantees both.
  if (weightEnd === undefined || weightStart === undefined)
    throw new Error("weight trend missing for body fat window");
  const weightChange = weightEnd - weightStart;
  return {
    readings,
    trend: {
      status: "ready" as const,
      level_pct: oneDecimal(level),
      change_points: change,
      lines: [
        trainingSentence(strengthCount),
        weightSentence(weightChange),
        bodyFatSentence(change, withinError),
      ],
    },
  };
}
