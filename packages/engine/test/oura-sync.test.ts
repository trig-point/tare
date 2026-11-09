import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { createOuraSyncJob } from "../src/oura/sync.ts";
import { origin, setup } from "./oura-refresh-support.ts";
import { test } from "./support/hang-ceiling.ts";

const today = "2026-01-01";
const period = (owner: number, id: string, minutes: number) => ({
  id: `${owner}-${id}`,
  day: today,
  type: "long_sleep",
  total_sleep_duration: minutes * 60,
  bedtime_start: "2025-12-31T23:00:00.000+00:00",
  bedtime_end: `2026-01-01T0${owner}:00:00.000+00:00`,
  lowest_heart_rate: 50 + owner,
  average_hrv: 40,
});
function bodies(owner: number, sleep = true) {
  return {
    daily_sleep: [{ day: today, score: sleep ? 80 + owner : null }],
    daily_stress: [
      {
        day: today,
        stress_high: 1800,
        recovery_high: 0,
        day_summary: "normal",
      },
    ],
    daily_activity: [{ day: today, steps: 1000 * owner, active_calories: 300 }],
    sleep: sleep ? [period(owner, "night", 400), period(owner, "nap", 20)] : [],
    daily_readiness: [{ day: today, score: 70 + owner }],
    workout: ["run", "walk"].map((kind, index) => ({
      id: `${owner}-${kind}`,
      day: today,
      activity: kind,
      calories: 100,
      start_datetime: `2026-01-01T${["02", "11"][index]}:00:00.000+00:00`,
      end_datetime: `2026-01-01T${["02", "11"][index]}:30:00.000+00:00`,
    })),
  };
}
function harness(
  context: TestContext,
  creditMode: "same-day" | "next-day" = "same-day",
) {
  const fixture = setup(context);
  for (const owner of [1, 2])
    fixture.seed(owner, 0, new Date(origin + 86_400_000).toISOString());
  const replies = new Map<number, (endpoint: string) => Response>();
  const requests: string[] = [];
  const reply =
    (owner: number, sleep = true) =>
    (endpoint: string) =>
      Response.json({ data: bodies(owner, sleep)[endpoint as "sleep"] });
  replies.set(1, reply(1));
  replies.set(2, reply(2));
  let finished = 0;
  const job = createOuraSyncJob({
    onFinished: () => finished++,
    database: fixture.database,
    oura: fixture.service(),
    clock: fixture.clock,
    creditMode,
    wait: async () => {},
    fetch: (async (url: URL, init: RequestInit) => {
      const owner = Number(
        String(new Headers(init.headers).get("authorization")).at(-1),
      );
      requests.push(`${url.pathname} ${url.searchParams.get("start_date")}`);
      return (replies.get(owner) as (endpoint: string) => Response)(
        url.pathname.split("/").at(-1) as string,
      );
    }) as typeof fetch,
  });
  const count = (table: string, owner: number) =>
    (
      fixture.database
        .prepare(`SELECT count(*) AS total FROM ${table} WHERE user_id = ?`)
        .get(owner) as { total: number }
    ).total;
  const counts = (owner: number) =>
    ["daily_signals", "sleep_periods", "activity_sessions"].map((table) =>
      count(table, owner),
    );
  const run = () => job.run({ signal: new AbortController().signal });
  const runs = () => finished;
  return { ...fixture, job, replies, reply, requests, counts, run, runs };
}

test("same-day credit syncs hourly; next-day credit keeps 7 AM", (context) => {
  assert.equal(harness(context).job.schedule, "0 * * * *");
  assert.equal(harness(context, "next-day").job.schedule, "0 7 * * *");
});

test("a run stores each person's own signals and last sync; re-runs and overlapping runs add nothing", async (context) => {
  const sync = harness(context);
  assert.equal(await sync.run(), "oura_synced:2");
  assert.equal(sync.runs(), 1);
  assert.deepEqual(
    [sync.counts(1), sync.counts(2)],
    [
      [10, 2, 2],
      [10, 2, 2],
    ],
  );
  const steps = sync.database
    .prepare(
      "SELECT user_id, value FROM daily_signals WHERE metric = 'steps' AND source = 'oura' ORDER BY user_id",
    )
    .all();
  assert.deepEqual(steps, [
    { user_id: 1, value: 1000 },
    { user_id: 2, value: 2000 },
  ]);
  assert.equal(sync.row(1)?.last_synced_at, new Date(origin).toISOString());
  const early =
    "SELECT day FROM activity_sessions WHERE source_record_id = '1-run'";
  assert.deepEqual(sync.database.prepare(early).get(), { day: "2025-12-31" });
  await sync.run();
  await Promise.all([sync.run(), sync.run()]);
  assert.deepEqual(
    [sync.counts(1), sync.counts(2)],
    [
      [10, 2, 2],
      [10, 2, 2],
    ],
  );
});

test("a storing failure leaves last sync unchanged and stores nothing; missing sleep is not an error", async (context) => {
  const sync = harness(context);
  sync.replies.set(1, sync.reply(1, false));
  sync.database.exec(
    "CREATE TRIGGER refuse BEFORE INSERT ON sleep_periods WHEN NEW.user_id = 2 BEGIN SELECT RAISE(ABORT, 'refused'); END",
  );
  await assert.rejects(sync.run());
  assert.deepEqual(
    [sync.counts(1), sync.counts(2)],
    [
      [6, 0, 2],
      [0, 0, 0],
    ],
  );
  assert.equal(sync.row(1)?.last_synced_at, new Date(origin).toISOString());
  assert.equal(sync.row(2)?.last_synced_at, null);
});

test("a 403 on data marks only that person as needing membership", async (context) => {
  const sync = harness(context);
  sync.replies.set(2, () => new Response(null, { status: 403 }));
  await assert.rejects(sync.run());
  assert.deepEqual(
    [sync.row(1)?.status, sync.row(2)?.status],
    ["connected", "membership_required"],
  );
  sync.replies.set(2, sync.reply(2));
  assert.equal(await sync.run(), "oura_synced:2");
  assert.equal(sync.row(2)?.status, "connected");
});

test("a 401 on data marks only that person as needing reconnect", async (context) => {
  const sync = harness(context);
  sync.replies.set(2, () => new Response(null, { status: 401 }));
  await assert.rejects(sync.run());
  assert.deepEqual(
    [sync.row(1)?.status, sync.row(2)?.status],
    ["connected", "reconnect_required"],
  );
});

test("a 401 after the token's stored expiry leaves the connection connected", async (context) => {
  const sync = harness(context);
  sync.replies.set(2, () => {
    sync.setTime(origin + 2 * 86_400_000);
    return new Response(null, { status: 401 });
  });
  await assert.rejects(sync.run());
  assert.equal(sync.row(2)?.status, "connected");
});

test("the first run after upgrade re-reads 30 days of sleep score and stress, once", async (context) => {
  const sync = harness(context);
  const earlier = "2025-12-31T12:00:00.000Z";
  sync.database
    .prepare("UPDATE oura_connections SET last_synced_at = ?")
    .run(earlier);
  const starts = () =>
    sync.requests.splice(0).filter((line) => line.includes("/daily_s"));
  await sync.run();
  assert.equal(
    sync.row(1)?.scores_backfilled_at,
    new Date(origin).toISOString(),
  );
  assert.match(
    starts().join(),
    /daily_sleep 2025-12-02,.*daily_stress 2025-12-02/,
  );
  await sync.run();
  assert.match(starts()[0] as string, /daily_sleep 2025-12-28/);
});
