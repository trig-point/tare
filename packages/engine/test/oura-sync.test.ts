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
    daily_activity: [{ day: today, steps: 1000 * owner, active_calories: 300 }],
    sleep: sleep ? [period(owner, "night", 400), period(owner, "nap", 20)] : [],
    daily_readiness: [{ day: today, score: 70 + owner }],
    workout: ["run", "walk"].map((kind, index) => ({
      id: `${owner}-${kind}`,
      day: today,
      activity: kind,
      calories: 100,
      start_datetime: `2026-01-01T1${index}:00:00.000+00:00`,
      end_datetime: `2026-01-01T1${index}:30:00.000+00:00`,
    })),
  };
}
function harness(context: TestContext) {
  const fixture = setup(context);
  for (const owner of [1, 2])
    fixture.seed(owner, 0, new Date(origin + 86_400_000).toISOString());
  const replies = new Map<number, (endpoint: string) => Response>();
  const reply =
    (owner: number, sleep = true) =>
    (endpoint: string) =>
      Response.json({ data: bodies(owner, sleep)[endpoint as "sleep"] });
  replies.set(1, reply(1));
  replies.set(2, reply(2));
  const job = createOuraSyncJob({
    database: fixture.database,
    oura: fixture.service(),
    clock: fixture.clock,
    wait: async () => {},
    fetch: (async (url: URL, init: RequestInit) => {
      const owner = Number(
        String(new Headers(init.headers).get("authorization")).at(-1),
      );
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
  return { ...fixture, replies, reply, counts, run };
}

test("a run stores each person's own signals and last sync; re-runs and overlapping runs add nothing", async (context) => {
  const sync = harness(context);
  assert.equal(await sync.run(), "oura_synced:2");
  assert.deepEqual(
    [sync.counts(1), sync.counts(2)],
    [
      [6, 2, 2],
      [6, 2, 2],
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
  await sync.run();
  await Promise.all([sync.run(), sync.run()]);
  assert.deepEqual(
    [sync.counts(1), sync.counts(2)],
    [
      [6, 2, 2],
      [6, 2, 2],
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
      [3, 0, 2],
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
