import type { Database } from "better-sqlite3";
import { shiftDay } from "../logging/day.ts";
import { selectHabitDays } from "../queries/select-habit-days.ts";
import { selectSignalHistory } from "../queries/select-signal-history.ts";
import { readWorkouts } from "./activities.ts";

const lookbackDays = 90;
const minimumNights = 5;
const clearPercent = 10;
const caveat =
  "Small sample; days you log may differ from days you don't in other ways.";
const items: Record<string, { lead: string; without: string }> = {
  strength: { lead: "a logged strength session", without: "one" },
  cardio: { lead: "a logged cardio session", without: "one" },
  sauna: { lead: "a logged sauna", without: "one" },
  cold_plunge: { lead: "a logged cold plunge", without: "one" },
  evening_alcohol: { lead: "logged alcohol", without: "any" },
  late_caffeine: { lead: "logged late caffeine", without: "any" },
};
const signalNames: Record<string, string> = {
  hrv: "HRV",
  resting_heart_rate: "resting heart rate",
  sleep: "sleep",
};

const average = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

function patternLine(
  item: string,
  signal: string,
  logged: number[],
  without: number[],
) {
  const { lead, without: article } = items[item] ?? {
    lead: item,
    without: "one",
  };
  const counts = `(${logged.length} vs ${without.length} nights)`;
  const change = (average(logged) - average(without)) / average(without);
  if (Math.abs(change) * 100 < clearPercent)
    return `Nights after ${lead}: no clear difference yet in ${signal} ${counts}. ${caveat}`;
  const percent = Math.round(Math.abs(change) * 100);
  const direction = change > 0 ? "higher" : "lower";
  return `Nights after ${lead}: ${signal} averaged ${percent}% ${direction} than nights without ${article} logged ${counts}. ${caveat}`;
}

/** Tier-two lines for night `day`, keyed by series then item, only for items logged the day before. */
export function personalPatterns(
  database: Database,
  owner: { user_id: number; day: string },
) {
  const { user_id, day } = owner;
  const from = shiftDay(day, -lookbackDays);
  const yesterday = shiftDay(day, -1);
  const loggedDays = new Map<string, Set<string>>();
  const mark = (item: string, onDay: string) => {
    if (!(item in items)) return;
    const days = loggedDays.get(item) ?? new Set<string>();
    days.add(onDay);
    loggedDays.set(item, days);
  };
  for (const workout of readWorkouts(database, {
    user_id,
    from,
    to: yesterday,
  }))
    mark(workout.category, workout.day);
  for (const habit of selectHabitDays(database, {
    user_id,
    from,
    to: yesterday,
  }))
    mark(habit.habit_key, habit.day);
  const due = [...loggedDays].filter(([, days]) => days.has(yesterday));
  const lines = new Map<string, Map<string, string>>();
  if (due.length === 0) return lines;
  const history = selectSignalHistory(database, {
    user_id,
    from: shiftDay(from, 1),
    to: day,
  });
  const series = Map.groupBy(history, (row) =>
    JSON.stringify([row.metric, row.source]),
  );
  for (const [key, rows] of series) {
    const signal = signalNames[rows[0]?.metric ?? ""];
    if (!signal) continue;
    const nightAfter = new Map(rows.map((row) => [row.day, row.value]));
    for (const [item, days] of due) {
      const logged: number[] = [];
      const without: number[] = [];
      for (let offset = 1; offset <= lookbackDays; offset += 1) {
        const logDay = shiftDay(day, -offset);
        const value = nightAfter.get(shiftDay(logDay, 1));
        if (value === undefined) continue;
        (days.has(logDay) ? logged : without).push(value);
      }
      if (logged.length < minimumNights || without.length < minimumNights)
        continue;
      if (average(without) === 0) continue;
      const byItem = lines.get(key) ?? new Map<string, string>();
      byItem.set(item, patternLine(item, signal, logged, without));
      lines.set(key, byItem);
    }
  }
  return lines;
}
