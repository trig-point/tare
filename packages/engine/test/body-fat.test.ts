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
const timedWorkout = (end: string, category = "strength"): TrendWorkout => ({
  timing: "exact",
  started_at: new Date(Date.parse(end) - 3_600_000).toISOString(),
  duration_minutes: 60,
  day: end.slice(0, 10),
  category: category as TrendWorkout["category"],
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
  const result = trend(
    [reading(yesterday, 24, "09:00"), reading(today, 24, "09:00")],
    [
      timedWorkout(`${yesterday}T06:00:00.000Z`, "sauna"),
      timedWorkout(`${today}T06:00:00.000Z`),
    ],
  );
  assert.deepEqual(flags(result), [
    [true, false],
    [true, false],
  ]);
});

test("a reading after a date-only session stays in the trend", () => {
  const dateOnly: TrendWorkout = {
    timing: "date_only",
    started_at: null,
    duration_minutes: null,
    day: shiftDay(today, -1),
    category: "strength",
  };
  const result = trend([...windows(22, 22), reading(today, 24)], [dateOnly]);
  assert.deepEqual(flags(result).at(-1), [false, true]);
  assert.equal(result.trend?.lines[0], "1 strength session logged in 3 weeks.");
});

test("a second weigh-in in a day stays out of the trend", () => {
  const result = trend([reading(today, 24), reading(today, 30, "19:00")]);
  assert.deepEqual(flags(result), [
    [false, true],
    [false, false],
  ]);
});

test("6 readings in a window says not enough readings for a trend", () => {
  assert.deepEqual(trend(windows(22, 22, 6)).trend, {
    status: "not_enough",
    current_count: 6,
    prior_count: 10,
    lines: [
      "Not enough readings for a trend",
      "6 of 8 readings in the last 4 weeks",
    ],
  });
});

test("a 1.2-point change reads within this scale's error", () => {
  assert.equal(
    trend(windows(22, 23.2)).trend?.lines[2],
    "Body fat reading up 1.2 points, within this scale's error.",
  );
});

test("the lines for no strength sessions, weight down 1.2 kg and body fat up 1 point", () => {
  const oldStrength = timedWorkout(`${shiftDay(today, -21)}T06:00:00.000Z`);
  assert.deepEqual(trend(windows(22, 23), [oldStrength]).trend?.lines, [
    "No strength sessions logged in 3 weeks.",
    "Weight down 1.2 kg.",
    "Body fat reading up 1 point, within this scale's error.",
  ]);
});

test("no body fat readings gives no trend", () => {
  assert.deepEqual(trend([]), { readings: [], trend: null });
});

test("one person's trend never uses another person's readings or workouts", async (context) => {
  const setup = await twoUsers(context, "fallback");
  const day = "2025-12-30";
  for (const [index, owner] of [setup.admin, setup.member].entries())
    insertWeight(setup.database, {
      user_id: owner.user.id,
      client_id: `invented-weight-${index}`,
      measured_at: `${day}T09:00:00.000Z`,
      day,
      weight_kg: 70 + index,
      body_fat_pct: 20 + index,
      source: null,
      created_at: `${day}T09:00:00.000Z`,
    });
  const logged = await setup.member.request("/api/activities", {
    method: "POST",
    body: JSON.stringify({
      started_at: `${day}T05:00:00.000Z`,
      duration_minutes: 60,
      kind: "strength",
    }),
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
