import type { Database } from "better-sqlite3";
import type { WhySettings } from "../config.ts";
import { shiftDay } from "../logging/day.ts";
import { selectHabits } from "../queries/select-habits.ts";
import { selectSignalHistory } from "../queries/select-signal-history.ts";
import { selectSleepPeriods } from "../queries/select-sleep-periods.ts";
import { readWorkouts } from "./activities.ts";

type Workout = ReturnType<typeof readWorkouts>[number];
type Direction = "up" | "down";
const wholeKcal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const hard = new Set(["strength", "cardio"]);
const plungeNames: Record<string, string> = {
  sauna: "sauna",
  cold_plunge: "cold plunge",
};
const signalNames: Record<string, string> = {
  hrv: "HRV",
  resting_heart_rate: "resting heart rate",
};

const seriesKey = (row: { metric: string; source: string }) =>
  JSON.stringify([row.metric, row.source]);

function departure(values: number[], today: number, settings: WhySettings) {
  if (values.length < settings.minBaselineDays) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  const spread = Math.sqrt(variance);
  if (spread === 0 || Math.abs(today - mean) <= settings.deviations * spread)
    return null;
  return { mean, direction: (today > mean ? "up" : "down") as Direction };
}

const endOf = (workout: Workout) =>
  workout.timing === "exact" && workout.started_at
    ? Date.parse(workout.started_at) + (workout.duration_minutes ?? 0) * 60_000
    : null;

function candidates(
  metric: string,
  direction: Direction,
  today: number,
  mean: number,
  context: {
    sameDay: Workout[];
    recent: Workout[];
    window: Workout[];
    sleepStart: number | null;
    alcohol: boolean;
    settings: WhySettings;
  },
) {
  const lines: string[] = [];
  if (metric === "active_calories" && direction === "up") {
    const sessions = context.sameDay.filter((workout) =>
      hard.has(workout.category),
    );
    const timed = sessions.flatMap((workout) =>
      workout.timing === "exact" && workout.duration_minutes
        ? [workout.duration_minutes]
        : [],
    );
    const lead = `Burn ${wholeKcal.format(today)} kcal, above your usual ${wholeKcal.format(mean)}.`;
    if (timed.length > 0)
      lines.push(`${lead} You logged a ${Math.max(...timed)}-minute workout.`);
    else if (sessions.length > 0) lines.push(`${lead} You logged a workout.`);
  }
  const heart =
    (metric === "hrv" && direction === "down") ||
    (metric === "resting_heart_rate" && direction === "up");
  const { sleepStart, settings } = context;
  if (heart && sleepStart !== null) {
    const late = context.recent.some((workout) => {
      const end = endOf(workout);
      return (
        end !== null &&
        hard.has(workout.category) &&
        (workout.duration_minutes ?? 0) >= settings.lateMinutes &&
        end <= sleepStart &&
        end >= sleepStart - settings.lateHours * 3_600_000
      );
    });
    if (late)
      lines.push(
        `You trained within ${settings.lateHours} hours of bed. Late hard workouts are linked to lower HRV.`,
      );
  }
  if (metric === "hrv" && direction === "down" && context.alcohol)
    lines.push(
      "You logged alcohol last evening. Alcohol is linked to lower HRV.",
    );
  const signalName = signalNames[metric];
  if (signalName)
    for (const [category, name] of Object.entries(plungeNames))
      if (context.window.some((workout) => workout.category === category))
        lines.push(
          `You logged ${name} yesterday. Its effect on ${signalName} is not settled.`,
        );
  return lines;
}

export function whyLines(
  database: Database,
  owner: { user_id: number; day: string },
  settings: WhySettings,
) {
  const { user_id, day } = owner;
  const previous = shiftDay(day, -1);
  const history = selectSignalHistory(database, {
    user_id,
    from: shiftDay(day, -settings.baselineDays),
    to: day,
  });
  // Rows are sorted by day, so each day's first row is its longest sleep.
  const mainSleep = new Map<string, { start: number; end: number }>();
  for (const period of selectSleepPeriods(database, {
    user_id,
    from: previous,
    to: day,
  }))
    if (!mainSleep.has(period.day))
      mainSleep.set(period.day, {
        start: Date.parse(period.started_at),
        end: Date.parse(period.ended_at),
      });
  const workouts = readWorkouts(database, { user_id, from: previous, to: day });
  const tonight = mainSleep.get(day);
  const lastNight = mainSleep.get(previous);
  const window = workouts.filter((workout) => {
    const end = endOf(workout);
    return (
      end !== null &&
      tonight !== undefined &&
      lastNight !== undefined &&
      end > lastNight.end &&
      end < tonight.start
    );
  });
  const context = {
    sameDay: workouts.filter((workout) => workout.day === day),
    recent: workouts,
    window,
    sleepStart: tonight?.start ?? null,
    alcohol: selectHabits(database, { user_id, day: previous }).some(
      (habit) => habit.habit_key === "evening_alcohol",
    ),
    settings,
  };
  const lines = new Map<string, string[]>();
  const series = Map.groupBy(history, (row) => seriesKey(row));
  for (const [key, rows] of series) {
    const current = rows.find((row) => row.day === day);
    if (!current) continue;
    const baseline = rows
      .filter((row) => row.day < day)
      .map((row) => row.value);
    const moved = departure(baseline, current.value, settings);
    if (!moved) continue;
    if (
      current.metric === "hrv" &&
      Math.abs(current.value - moved.mean) <
        (settings.hrvPercent / 100) * moved.mean
    )
      continue;
    lines.set(
      key,
      candidates(
        current.metric,
        moved.direction,
        current.value,
        moved.mean,
        context,
      ),
    );
  }
  return (signal: { metric: string; source: string }) =>
    lines.get(seriesKey(signal)) ?? [];
}
