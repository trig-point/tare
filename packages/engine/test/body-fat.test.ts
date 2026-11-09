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

test("a reading 3 hours after a timed workout is marked and left out", () => {
  const morning = reading(today, 24, "09:00");
  const result = trend([morning], [timedWorkout(`${today}T06:00:00.000Z`)]);
  assert.deepEqual(
    result.readings.map((row) => [row.after_workout, row.in_trend]),
    [[true, false]],
  );
});

test("a reading after a date-only session stays in the trend", () => {
  const dateOnly: TrendWorkout = {
    timing: "date_only",
    started_at: null,
    duration_minutes: null,
    day: shiftDay(today, -1),
    category: "strength",
  };
  const result = trend([reading(today, 24)], [dateOnly]);
  assert.deepEqual(
    result.readings.map((row) => [row.after_workout, row.in_trend]),
    [[false, true]],
  );
});

test("a second weigh-in in a day stays out of the trend", () => {
  const result = trend([reading(today, 24), reading(today, 30, "19:00")]);
  assert.deepEqual(
    result.readings.map((row) => row.in_trend),
    [true, false],
  );
});

test("6 readings in a window says not enough readings for a trend", () => {
  const result = trend(windows(22, 22, 6));
  assert.equal(result.readings.length, 16);
  assert.deepEqual(result.trend, {
    status: "not_enough",
    current_count: 6,
    prior_count: 10,
    message: "Not enough readings for a trend",
  });
});

test("a 1.2-point change reads within this scale's error of about 2 points", () => {
  const result = trend(windows(22, 23.2));
  assert.equal(result.trend?.status, "ready");
  assert.equal(
    result.trend?.message,
    "Up 1.2 points, within this scale's error of about 2 points",
  );
});

test("the joined line for no strength sessions, weight down 1.2 kg and body fat up 1 point", () => {
  const oldStrength = timedWorkout(`${shiftDay(today, -21)}T06:00:00.000Z`);
  const result = trend(windows(22, 23), [oldStrength]);
  assert.equal(result.trend?.status, "ready");
  assert.equal(
    result.trend?.status === "ready" && result.trend.line,
    "No strength sessions logged in 3 weeks. Weight down 1.2 kg. Body fat reading up 1 point, within this scale's error.",
  );
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
  const history = async (person: typeof setup.admin) =>
    (await person.request("/api/body-fat/history")).json();
  const [admin, member] = [
    await history(setup.admin),
    await history(setup.member),
  ];
  assert.deepEqual(
    admin.readings.map((row: BodyFatReading & { after_workout: boolean }) => [
      row.body_fat_pct,
      row.after_workout,
    ]),
    [[20, false]],
  );
  assert.deepEqual(
    member.readings.map((row: BodyFatReading & { after_workout: boolean }) => [
      row.body_fat_pct,
      row.after_workout,
    ]),
    [[21, true]],
  );
});
