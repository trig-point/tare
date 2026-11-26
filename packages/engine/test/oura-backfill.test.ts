import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { Person } from "../src/auth/middleware.ts";
import { operations } from "../src/operations/index.ts";
import {
  executeOperation,
  OperationError,
} from "../src/operations/registry.ts";
import { backfillOura } from "../src/oura/backfill.ts";
import { upsertSignal } from "../src/queries/upsert-signal.ts";
import { origin, setup } from "./oura-refresh-support.ts";
import { test } from "./support/hang-ceiling.ts";

// The clock sits at 2026-01-01, so the sync window starts on 2025-12-03.
const windowStart = "2025-12-03";
const none = {
  days_written: 0,
  first_day: null,
  last_day: null,
};
const sleepSide = (days: string[], heart = 52) => ({
  daily_sleep: days.map((day) => ({ day, score: 81 })),
  daily_readiness: days.map((day) => ({ day, score: 74 })),
  sleep: days.map((day) => ({
    id: `night-${day}`,
    day,
    type: "long_sleep",
    total_sleep_duration: 420 * 60,
    bedtime_start: `${day}T00:00:00.000+00:00`,
    bedtime_end: `${day}T07:00:00.000+00:00`,
    lowest_heart_rate: heart,
    average_hrv: 45,
  })),
});

function harness(context: TestContext) {
  const fixture = setup(context);
  fixture.seed(1, 0, new Date(origin + 86_400_000).toISOString());
  const stub = {
    bodies: {} as Record<string, unknown[]>,
    failing: {} as Record<string, number>,
  };
  const requests: string[] = [];
  const fakeFetch = (async (url: URL) => {
    const endpoint = url.pathname.split("/").at(-1) as string;
    const range = ["start_date", "end_date"].map((name) =>
      url.searchParams.get(name),
    );
    requests.push(`${endpoint} ${range.join(" ")}`);
    const status = stub.failing[endpoint];
    if (status) return new Response(null, { status });
    return Response.json({ data: stub.bodies[endpoint] ?? [] });
  }) as typeof globalThis.fetch;
  const oura = fixture.service();
  const all = (sql: string) =>
    fixture.database.prepare(sql).all() as Record<string, unknown>[];
  return {
    ...fixture,
    stub,
    requests,
    run: (since: string) =>
      backfillOura({
        database: fixture.database,
        oura,
        clock: fixture.clock,
        person: { id: 1, timezone: "UTC", day_start_hour: 0 },
        since,
        fetch: fakeFetch,
        wait: async () => {},
      }),
    signals: () =>
      all("SELECT * FROM daily_signals ORDER BY day, metric, source"),
    periods: () => all("SELECT * FROM sleep_periods ORDER BY day"),
    activities: () => all("SELECT * FROM activity_sessions"),
    hold: (day: string, value: number) =>
      upsertSignal(fixture.database, {
        ...{ user_id: 1, day, metric: "hrv", value, source: "oura" },
        updated_at: new Date(origin).toISOString(),
      }),
  };
}

test("with no history held, writes only sleep-side signals, only before the sync window", async (context) => {
  const backfill = harness(context);
  backfill.stub.bodies = {
    ...sleepSide(["2025-11-10", "2025-11-11", windowStart]),
    daily_activity: [{ day: "2025-11-10", steps: 9000, active_calories: 400 }],
    daily_stress: [{ day: "2025-11-10", stress_high: 1800 }],
    workout: [{ id: "run", day: "2025-11-10", activity: "running" }],
  };
  const result = await backfill.run("2025-11-01");
  assert.deepEqual([result.days_written, result.last_day], [2, "2025-11-11"]);
  assert.deepEqual(
    backfill.requests,
    ["sleep", "daily_readiness", "daily_sleep"].map(
      (endpoint) => `${endpoint} 2025-11-01 ${windowStart}`,
    ),
  );
  assert.deepEqual(
    backfill
      .signals()
      .filter((row) => row.day === "2025-11-10")
      .map((row) => `${row.metric}=${row.value}`),
    "hrv=45 readiness=74 resting_heart_rate=52 sleep=420 sleep_score=81".split(
      " ",
    ),
  );
  assert.deepEqual(
    backfill.periods().map((row) => row.day),
    ["2025-11-10", "2025-11-11"],
  );
  assert.deepEqual(backfill.activities(), []);
});

test("a second run changes nothing", async (context) => {
  const backfill = harness(context);
  backfill.stub.bodies = sleepSide(["2025-11-01", "2025-11-10"]);
  await backfill.run("2025-11-01");
  const before = [backfill.signals(), backfill.periods()];
  backfill.setTime(origin + 3_600_000);
  backfill.requests.length = 0;
  assert.deepEqual(await backfill.run("2025-11-01"), none);
  assert.deepEqual(backfill.requests, []);
  assert.deepEqual([backfill.signals(), backfill.periods()], before);
});

test("never writes on or after the earliest held Oura day; a later since is a no-op", async (context) => {
  const backfill = harness(context);
  backfill.hold("2025-10-20", 30);
  backfill.stub.bodies = sleepSide(
    ["2025-10-19", "2025-10-20", "2025-10-21"],
    60,
  );
  for (const since of ["2025-10-20", "2026-02-01"])
    assert.deepEqual(await backfill.run(since), none);
  assert.deepEqual(backfill.requests, []);
  assert.equal((await backfill.run("2025-10-01")).last_day, "2025-10-19");
  assert.equal(backfill.requests[0], "sleep 2025-10-01 2025-10-20");
  assert.deepEqual(
    backfill
      .signals()
      .map((row) => [row.day, row.metric, row.value])
      .filter(([day]) => String(day) >= "2025-10-20"),
    [["2025-10-20", "hrv", 30]],
  );
  assert.deepEqual(
    backfill.periods().map((row) => row.day),
    ["2025-10-19"],
  );
});

test("an Oura refusal rejects with its code and leaves no partial writes", async (context) => {
  const backfill = harness(context);
  backfill.stub.bodies = sleepSide(["2025-11-10"]);
  for (const [status, code, httpStatus] of [
    [500, "oura_unavailable", 503],
    [401, "oura_unauthorized", 409],
  ] as const) {
    backfill.stub.failing = { daily_sleep: status };
    await assert.rejects(
      backfill.run("2025-11-01"),
      new OperationError(httpStatus, code),
    );
    assert.deepEqual([backfill.signals(), backfill.periods()], [[], []]);
  }
});

test("stops at the sync window start even when the earliest held day is later", async (context) => {
  const backfill = harness(context);
  backfill.hold("2025-12-10", 30);
  backfill.stub.bodies = sleepSide(["2025-11-10", windowStart, "2025-12-05"]);
  assert.equal((await backfill.run("2025-11-01")).last_day, "2025-11-10");
  assert.equal(backfill.requests[0], `sleep 2025-11-01 ${windowStart}`);
  assert.deepEqual(
    backfill.periods().map((row) => row.day),
    ["2025-11-10"],
  );
});

test("the oura_backfill tool rejects a missing or malformed since before touching Oura", async (context) => {
  const fixture = setup(context);
  const operation = operations.find((item) => item.name === "oura_backfill");
  assert.ok(operation);
  assert.match(
    operation.description ?? "",
    /only sleep, HRV, resting heart rate and readiness/,
  );
  let refreshes = 0;
  const person = { id: 1, timezone: "UTC", day_start_hour: 0 } as Person;
  const deps = {
    ...fixture,
    dummyHash: "invented",
    verifyPassword: async () => false,
    signInLimiter: { waiting: 0 },
    oura: { refreshAccess: async () => void refreshes++ } as never,
  };
  for (const input of [
    {},
    { since: "2025-02-30" },
    { since: "last year" },
    { since: "2025-11-01T00:00:00Z" },
  ])
    await assert.rejects(
      executeOperation(
        operation,
        input,
        { person, credential: "service" },
        deps,
      ),
      new OperationError(400, "invalid_request"),
      JSON.stringify(input),
    );
  assert.equal(refreshes, 0);
});
