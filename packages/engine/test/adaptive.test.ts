import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { computeAdaptive, readAdaptive } from "../src/target/adaptive.ts";
import { weightTrend } from "../src/trend/weight-trend.ts";
import { cookie, fixture } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const settings = loadConfig({ DATABASE_URL: ":memory:" }).tdee;
const day = (offset: number) =>
  new Date(Date.UTC(2026, 9, 5 + offset)).toISOString().slice(0, 10);
const series = (first = 0, count = 8, start = 90, end = 89) =>
  Array.from({ length: count + (first === 0 ? 1 : 0) }, (_, index) => ({
    day: day(
      first +
        Math.round(((28 - first) * index) / (count - (first === 0 ? 0 : 1))),
    ),
    reading_kg: start,
    trend_kg: start + ((end - start) * index) / (count - (first === 0 ? 0 : 1)),
  }));
const signedDays = Array.from({ length: 20 }, (_, index) => ({
  day: day(index + 1),
}));
const intake = Array.from({ length: 28 }, (_, index) => ({
  day: day(index + 1),
  kcal: index < 20 ? 2400 : 9000,
  kcal_low: index === 0 ? 2100 : null,
  kcal_high: index === 0 ? 3000 : null,
  provenance: index === 0 ? "estimated" : "label",
}));
const input = {
  start: day(1),
  end: day(28),
  signedDays,
  intake,
  trend: series(),
};
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("worked estimates, unsigned days, bounds, held trend and learning reasons", () => {
  const cases = [
    [input, {}, [2675, 2660, 2705, 28]],
    [
      {
        ...input,
        signedDays: signedDays.slice(0, 16),
        intake: intake.map((entry) => ({
          ...entry,
          kcal: 2200,
          kcal_low: null,
          kcal_high: null,
          provenance: "label",
        })),
        trend: series(8, 10, 85, 84.2),
      },
      {},
      [2508, 2508, 2508, 20],
    ],
    [{ ...input, trend: series(20) }, {}, "span"],
    [{ ...input, signedDays: signedDays.slice(0, 13) }, {}, "signed_days"],
    [{ ...input, trend: series(0, 7) }, {}, "weigh_in_days"],
    [
      { ...input, intake: intake.map((entry) => ({ ...entry, kcal: null })) },
      {},
      "incomplete_intake",
    ],
    [{ ...input, signedDays: [], intake: [], trend: [] }, {}, "signed_days"],
    [
      {
        ...input,
        intake: intake.map((entry) => ({
          ...entry,
          kcal_low: null,
          kcal_high: null,
        })),
      },
      {},
      [2675, 2645, 2705, 28],
    ],
    [
      {
        ...input,
        intake: intake.map((entry) => ({
          ...entry,
          kcal_low: null,
          kcal_high: null,
        })),
      },
      { defaultRange: 0.1 },
      [2675, 2663, 2687, 28],
    ],
    [{ ...input, intake: intake.slice(0, 19) }, {}, [2555, 2540, 2585, 28]],
    [
      {
        ...input,
        trend: series().map((entry, index) => ({
          ...entry,
          day: index === 0 ? day(-4) : index === 8 ? day(27) : entry.day,
        })),
      },
      {},
      [2675, 2660, 2705, 28],
    ],
  ] as const;
  for (const [data, overrides, expected] of cases) {
    const result = computeAdaptive(data, { ...settings, ...overrides });
    if (typeof expected === "string") {
      assert.equal(result.status, "learning");
      if (result.status === "learning") assert.equal(result.reason, expected);
      if (expected === "span") assert.equal(result.span_days, 8);
    } else {
      assert.equal(result.status, "eligible");
      if (result.status !== "eligible")
        throw new Error("Expected eligible estimate");
      close(result.tdee_kcal, expected[0]);
      close(result.low_kcal, expected[1]);
      close(result.high_kcal, expected[2]);
      assert.equal(result.span_days, expected[3]);
      assert.ok(
        result.low_kcal <= result.tdee_kcal &&
          result.tdee_kcal <= result.high_kcal,
      );
    }
  }
});

test("deterministic energy balance converges toward a true 2500 kcal", () => {
  const history = Array.from({ length: 120 }, (_, offset) => ({
    day: day(offset),
    weight_kg: 95 - (offset * 200) / 7700,
  }));
  const trend = weightTrend(history);
  let previousError = Number.POSITIVE_INFINITY;
  for (const [elapsed, ceiling] of [
    [30, 60],
    [60, 3],
    [120, 0.01],
  ] as const) {
    const result = computeAdaptive(
      {
        start: day(elapsed - 28),
        end: day(elapsed - 1),
        trend,
        signedDays: history,
        intake: history.map((entry) => ({
          ...entry,
          kcal: 2300,
          kcal_low: null,
          kcal_high: null,
          provenance: "label",
        })),
      },
      settings,
    );
    assert.equal(result.status, "eligible");
    if (result.status !== "eligible")
      throw new Error("Expected simulator estimate");
    const error = Math.abs(result.tdee_kcal - 2500);
    assert.ok(error < previousError && error < ceiling);
    assert.ok(
      result.low_kcal <= result.tdee_kcal &&
        result.tdee_kcal <= result.high_kcal,
    );
    previousError = error;
  }
});

test("reader uses the person's yesterday, excludes today, and isolates owners", async (context) => {
  const { database, admin, member } = await twoUsers(context, "fallback");
  const now = new Date("2026-11-03T00:00:00.000Z");
  const person = {
    ...member.user,
    timezone: "Asia/Kolkata",
    day_start_hour: 4,
  };
  const time = now.toISOString();
  for (const actor of [admin.user, person]) {
    for (let offset = 1; offset <= 28; offset++) {
      database
        .prepare(
          "INSERT INTO intake_entries(user_id,client_id,day,eaten_at,name,kcal,provenance,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .run(
          actor.id,
          `food-${offset}`,
          day(offset),
          `${day(offset)}T12:00:00.000Z`,
          "Example meal",
          actor.id === person.id ? (offset <= 20 ? 2400 : 9000) : 1000,
          "label",
          time,
          time,
        );
      database
        .prepare(
          "UPDATE days SET signed_off_at = ? WHERE user_id = ? AND day = ?",
        )
        .run(offset <= 20 ? time : null, actor.id, day(offset));
    }
    for (const offset of [0, 3, 7, 11, 15, 19, 23, 26, 28])
      database
        .prepare(
          "INSERT INTO weights(user_id,client_id,day,measured_at,weight_kg,created_at) VALUES (?,?,?,?,?,?)",
        )
        .run(
          actor.id,
          `weight-${offset}`,
          day(offset),
          `${day(offset)}T12:00:00.000Z`,
          actor.id === person.id ? 90 - offset / 28 : 60,
          time,
        );
  }
  const before = readAdaptive(database, person, now, settings);
  assert.equal(before.status, "eligible", JSON.stringify(before));
  if (before.status !== "eligible") throw new Error("Expected reader estimate");
  assert.equal(before.span_days, 28);
  assert.equal(before.signed_days, 20);
  assert.equal(before.weigh_in_days, 8);
  assert.equal(before.mean_intake_kcal, 2400);
  database
    .prepare(
      "INSERT INTO weights(user_id,client_id,day,measured_at,weight_kg,created_at) VALUES (?,?,?,?,?,?)",
    )
    .run(person.id, "today", day(29), time, 200, time);
  assert.deepEqual(readAdaptive(database, person, now, settings), before);
  assert.notDeepEqual(
    readAdaptive(database, { ...person, timezone: "UTC" }, now, settings),
    before,
  );
  const other = readAdaptive(database, admin.user, now, settings);
  assert.equal(other.status, "eligible");
  if (other.status === "eligible") assert.equal(other.tdee_kcal, 1000);
  database
    .prepare(
      "UPDATE intake_entries SET kcal = NULL WHERE user_id = ? AND day = ?",
    )
    .run(person.id, day(1));
  database
    .prepare("UPDATE days SET signed_off_at = ? WHERE user_id = ? AND day = ?")
    .run(time, person.id, day(1));
  const incomplete = readAdaptive(database, person, now, settings);
  assert.equal(incomplete.status, "learning");
  if (incomplete.status === "learning")
    assert.equal(incomplete.reason, "incomplete_intake");
});

test("today passes configured settings and keeps the formula target", async (context) => {
  const setup = fixture(context, {
    config: loadConfig({
      DATABASE_URL: ":memory:",
      TARE_TDEE_MIN_SIGNED_DAYS: "1",
    }),
  });
  const headers = { Cookie: cookie(await setup.signIn()) };
  const request = (path: string, body?: unknown) =>
    setup.app.request(
      path,
      body === undefined
        ? { headers }
        : {
            method: "POST",
            headers: { ...headers, "X-Requested-With": "XMLHttpRequest" },
            body: JSON.stringify(body),
          },
    );
  await request("/api/profile", {
    height_cm: 180,
    birth_date: "1986-01-01",
    sex: "male",
    activity_level: "moderate",
    goal_rate_kg_week: -0.5,
  });
  await request("/api/weights", { client_id: "example", weight_kg: 80 });
  setup.database
    .prepare("INSERT INTO days(user_id, day, signed_off_at) VALUES (?,?,?)")
    .run(setup.admin.id, "2025-12-31", "2026-01-01T00:00:00.000Z");
  const response = await request("/api/today");
  assert.equal(response.status, 200);
  const { target } = await response.json();
  assert.equal(target.kcal, 2130);
  assert.deepEqual(target.adaptive, {
    status: "learning",
    reason: "weigh_in_days",
    signed_days: 1,
    weigh_in_days: 0,
    span_days: null,
  });
});
