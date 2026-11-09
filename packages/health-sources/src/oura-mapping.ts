import type { OuraData } from "./oura-client.ts";
import { stressSummaries } from "./oura-schema.ts";

export interface OuraSignals {
  daily: { day: string; metric: string; value: number }[];
  sleepPeriods: {
    recordId: string;
    day: string;
    startedAt: string;
    endedAt: string;
    sleepMinutes: number;
    kind: string;
  }[];
  sessions: {
    recordId: string;
    day: string;
    startedAt: string;
    durationMinutes: number;
    kind: string;
    calories: number | null;
  }[];
}

const instant = (value: string) => new Date(value).toISOString();

export function mapOura(data: OuraData): OuraSignals {
  const daily: OuraSignals["daily"] = [];
  const add = (day: string, metric: string, value: number | null = null) => {
    if (value !== null && value !== undefined)
      daily.push({ day, metric, value });
  };
  for (const record of data.daily_activity) {
    add(record.day, "steps", record.steps);
    add(record.day, "active_calories", record.active_calories);
  }
  for (const record of data.daily_readiness)
    add(record.day, "readiness", record.score);
  for (const record of data.daily_sleep)
    add(record.day, "sleep_score", record.score);
  const minutes = (seconds: number | null = null) =>
    seconds === null ? null : seconds / 60;
  for (const record of data.daily_stress) {
    add(record.day, "stress_high", minutes(record.stress_high));
    add(record.day, "recovery_high", minutes(record.recovery_high));
    if (record.day_summary)
      add(
        record.day,
        "stress_summary",
        stressSummaries.indexOf(record.day_summary),
      );
  }

  const periods = data.sleep.filter((period) => period.type !== "deleted");
  const nights = Map.groupBy(periods, (period) => period.day);
  for (const [day, dayPeriods] of nights) {
    const total = dayPeriods.reduce(
      (sum, period) => sum + (period.total_sleep_duration ?? 0),
      0,
    );
    add(day, "sleep", Math.min(1440, Math.round(total / 60)));
    // The longest period is the main night, which Oura's heart figures come from.
    const main = dayPeriods.reduce((longest, period) =>
      (period.total_sleep_duration ?? 0) > (longest.total_sleep_duration ?? 0)
        ? period
        : longest,
    );
    if (main.lowest_heart_rate)
      add(day, "resting_heart_rate", main.lowest_heart_rate);
    if (main.average_hrv) add(day, "hrv", main.average_hrv);
  }
  return {
    daily,
    sleepPeriods: periods
      .filter(
        (period) =>
          Date.parse(period.bedtime_end) > Date.parse(period.bedtime_start),
      )
      .map((period) => ({
        recordId: period.id,
        day: period.day,
        startedAt: instant(period.bedtime_start),
        endedAt: instant(period.bedtime_end),
        sleepMinutes: Math.min(
          1440,
          Math.round((period.total_sleep_duration ?? 0) / 60),
        ),
        kind: period.type,
      })),
    sessions: data.workout.map((session) => ({
      recordId: session.id,
      day: session.day,
      startedAt: instant(session.start_datetime),
      durationMinutes: Math.max(
        1,
        Math.round(
          (Date.parse(session.end_datetime) -
            Date.parse(session.start_datetime)) /
            60_000,
        ),
      ),
      kind: session.activity,
      calories: session.calories ?? null,
    })),
  };
}
