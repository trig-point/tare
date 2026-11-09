import assert from "node:assert/strict";
import { insertWeight } from "../src/queries/insert-weight.ts";
import {
  type BodyFatReading,
  bodyFatTrend,
  shiftDay,
  type TrendWorkout,
} from "../src/trend/body-fat.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const today = "2026-03-31";
let nextId = 1;
const reading = (
  day: string,
  body_fat_pct: number,
  time = "07:00",
): BodyFatReading => ({
  id: nextId++,
  day,
  measured_at: `${day}T${time}:00.000Z`,
  body_fat_pct,
});
const workout = (
  day: string,
  category: TrendWorkout["category"] = "strength",
  started_at: string | null = `${day}T05:00:00.000Z`,
): TrendWorkout => ({
  timing: started_at ? "exact" : "date_only",
  started_at,
  duration_minutes: started_at ? 60 : null,
  day,
  category,
});
const windows = (prior: number, current: number, currentCount = 10) => [
  ...Array.from({ length: 10 }, (_, index) =>
    reading(shiftDay(today, -55 + index), prior),
  ),
  ...Array.from({ length: currentCount }, (_, index) =>
    reading(shiftDay(today, -27 + index), current),
  ),
];
const weights = [
  { day: shiftDay(today, -28), reading_kg: 80, trend_kg: 80 },
  { day: today, reading_kg: 78, trend_kg: 78.8 },
];
const trend = (readings: BodyFatReading[], workouts: TrendWorkout[] = []) =>
  bodyFatTrend({ readings, workouts, weights, today });
const flags = (result: ReturnType<typeof trend>) =>
  result.readings.map((row) => [row.after_workout, row.in_trend]);

test("a reading 3 hours after a timed workout or sauna is marked and left out", () => {
  const yesterday = shiftDay(today, -1);
  const readings = [
    reading(yesterday, 24, "09:00"),
    reading(today, 24, "09:00"),
  ];
  const result = trend(readings, [workout(yesterday, "sauna"), workout(today)]);
  assert.deepEqual(flags(result).flat(), [true, false, true, false]);
});

test("a reading after a date-only session stays in the trend", () => {
  const dateOnly = workout(shiftDay(today, -1), "strength", null);
  const result = trend([...windows(22, 22), reading(today, 24)], [dateOnly]);
  assert.deepEqual(flags(result).at(-1), [false, true]);
  assert.equal(result.trend?.lines[0], "1 strength session logged in 3 weeks.");
});

test("a second weigh-in in a day stays out of the trend", () => {
  const result = trend([reading(today, 24), reading(today, 30, "19:00")]);
  assert.deepEqual(flags(result).flat(), [false, true, false, false]);
});

test("6 readings in a window says not enough readings for a trend", () => {
  assert.deepEqual(trend(windows(22, 22, 6)).trend?.lines, [
    "Not enough readings for a trend",
    "6 of 8 readings in the last 4 weeks",
  ]);
});

test("the lines, and a 1.2-point change reads within this scale's error", () => {
  const oldStrength = workout(shiftDay(today, -21));
  assert.deepEqual(trend(windows(22, 23), [oldStrength]).trend?.lines, [
    "No strength sessions logged in 3 weeks.",
    "Weight down 1.2 kg.",
    "Body fat reading up 1 point, within this scale's error.",
  ]);
  assert.match(
    String(trend(windows(22, 23.2)).trend?.lines),
    /up 1.2 points, within/,
  );
});

test("no body fat readings gives no trend", () => {
  assert.deepEqual(trend([]), { readings: [], trend: null });
});

test("one person's trend never uses another person's readings or workouts", async (context) => {
  const setup = await twoUsers(context, "fallback");
  const day = "2025-12-30";
  const measured_at = `${day}T09:00:00.000Z`;
  for (const [index, owner] of [setup.admin, setup.member].entries())
    insertWeight(setup.database, {
      ...{ day, measured_at, created_at: measured_at, source: null },
      user_id: owner.user.id,
      client_id: `invented-weight-${index}`,
      weight_kg: 70,
      body_fat_pct: 20 + index,
    });
  const { started_at, duration_minutes } = workout(day);
  const logged = await setup.member.request("/api/activities", {
    method: "POST",
    body: JSON.stringify({ started_at, duration_minutes, kind: "strength" }),
  });
  assert.equal(logged.status, 200);
  const marks = async (person: typeof setup.admin) =>
    (await (await person.request("/api/body-fat/history")).json()).readings.map(
      (row: { body_fat_pct: number; after_workout: boolean }) => [
        row.body_fat_pct,
        row.after_workout,
      ],
    );
  assert.deepEqual(await marks(setup.admin), [[20, false]]);
  assert.deepEqual(await marks(setup.member), [[21, true]]);
});
