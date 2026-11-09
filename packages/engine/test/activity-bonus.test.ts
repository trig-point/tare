import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { writeTransaction } from "../src/db.ts";
import { shiftDay } from "../src/logging/day.ts";
import { readTarget } from "../src/target/reader.ts";
import { recomputeTarget } from "../src/target/recompute.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const config = loadConfig({ DATABASE_URL: ":memory:" });
const now = "2026-01-01T15:00:00.000Z";
const today = "2026-01-01";
const usual = Array<number | null>(28).fill(430);
const signal = "INSERT OR REPLACE INTO daily_signals VALUES (?, ?, ?, ?, ?, ?)";
const seeds = [
  "INSERT INTO profiles SELECT id, 180, '1986-01-01', 'male', 'moderate', -0.5, 1.6, '2026-01-01T00:00:00.000Z' FROM users",
  "INSERT INTO weights (user_id, client_id, measured_at, day, weight_kg, created_at) SELECT id, 'weight', '2026-01-01T08:00:00.000Z', '2026-01-01', 80, '2026-01-01T08:00:00.000Z' FROM users",
  "INSERT INTO oura_connections (user_id, version, ciphertext, iv, tag, access_expires_at, scopes, scope_source, status, generation, last_synced_at, created_at, updated_at) SELECT id, 1, 'x', 'x', 'x', '2026-01-01T15:00:00.000Z', 'daily', 'requested', 'connected', 1, '2026-01-01T15:00:00.000Z', '2026-01-01T15:00:00.000Z', '2026-01-01T15:00:00.000Z' FROM users",
  "INSERT INTO day_templates SELECT id, id, 'Example template', '2026-01-01T00:00:00.000Z' FROM users",
  "INSERT INTO template_slots SELECT id, id, slot, 'Example slot', slot * 720, slot * 720 + 720, 5000, NULL FROM users, (SELECT 0 AS slot UNION ALL SELECT 1)",
  "INSERT INTO day_types SELECT id, id, 'Example type', id FROM users",
  "INSERT INTO default_day_types SELECT id, id FROM users",
  "INSERT INTO activity_sessions (user_id, started_at, day, duration_minutes, kind, calories, source, created_at) SELECT id, '2026-01-01T13:00:00.000Z', '2026-01-01', 90, 'strength', 900, 'manual', '2026-01-01T15:00:00.000Z' FROM users",
  "INSERT INTO habit_log SELECT id, '2026-01-01', 'evening_alcohol', 3, NULL, 'manual', '2026-01-01T15:00:00.000Z' FROM users",
];

async function setup(context: Parameters<typeof twoUsers>[0]) {
  const fixture = await twoUsers(context, "fallback");
  const { database, admin } = fixture;
  fixture.setNow(now);
  for (const sql of seeds) database.exec(sql);
  const insert = database.prepare(signal);
  const burn = (
    day: string,
    value: number | null,
    history: readonly (number | null)[] = [],
    { source = "oura", metric = "active_calories", user = admin.user.id } = {},
  ) => {
    for (const [index, past] of [value, ...history].entries())
      if (past !== null)
        insert.run(user, shiftDay(day, -index), metric, past, source, now);
  };
  const read = (activityCredit: "same-day" | "next-day" = "same-day") => {
    const settings = { ...config, activityCredit };
    const target = readTarget(database, admin.user, new Date(now), settings);
    assert.ok(target.status === "ready");
    return target;
  };
  return { ...fixture, burn, read };
}

test("bonus: training, quiet, next-day, waiting, no source, cap and window", async (context) => {
  const { database, burn, read } = await setup(context);
  const gaps = [...Array(14).fill([400, null]).flat(), 9000];
  for (const [mode, history, value, expected] of [
    ["same-day", usual, 680, "2380 ready 250 680 430.0"],
    ["same-day", usual, 120, "2130 ready 0 120 430.0"],
    ["next-day", usual, 680, "2380 ready 250 680 430.0"],
    ["next-day", usual, null, "2130 waiting 0 null 430.0"],
    ["same-day", usual.slice(0, 9), null, "2130 no_source 0 null undefined"],
    ["same-day", gaps, 950, "2630 ready 500 capped 950 400.0"],
  ] as const) {
    database.prepare("DELETE FROM daily_signals").run();
    burn(mode === "same-day" ? today : shiftDay(today, -1), value, history);
    const { kcal, bonus } = read(mode);
    assert.equal(
      `${kcal} ${bonus.status} ${bonus.kcal}${bonus.capped ? " capped" : ""} ${bonus.burn_kcal} ${bonus.average_kcal?.toFixed(1)}`,
      expected,
    );
  }
});

test("guard: hand-entered burn, HRV, sleep, sessions, session calories and habit notes never change the target", async (context) => {
  const { burn, read } = await setup(context);
  for (const metric of ["hrv", "sleep", "resting_heart_rate", "steps"])
    burn(today, 9000, Array(28).fill(50), { metric });
  for (const source of ["manual", "agent"])
    burn(today, 2600, usual, { source });
  assert.deepEqual([read().kcal, read().bonus.status], [2130, "no_source"]);
  burn(today, 680, usual);
  assert.deepEqual([read().kcal, read().bonus.last_synced_at], [2380, now]);
});

test("slots, remaining and the weekly recompute follow the bonus; two users", async (context) => {
  const { database, admin, member, burn } = await setup(context);
  const read = async (person = admin) => {
    const get = async (path: string) => (await person.request(path)).json();
    const [plan, day] = [await get("/api/plan/today"), await get("/api/today")];
    const { slots } = plan.budgets;
    return { slots, target: day.target.kcal, left: day.remaining.kcal };
  };
  const before = await read();
  burn(today, 680, Array(14).fill([430, 431.2]).flat());
  const after = await read();
  assert.deepEqual(after.slots[0], before.slots[0]);
  assert.equal(after.slots[1].kcal.budget - before.slots[1].kcal.budget, 249);
  assert.deepEqual([after.target, after.left], [2379, 2379]);
  burn(today, 1500, Array(28).fill(100), { user: member.user.id });
  assert.deepEqual(await read(), after);
  assert.equal((await read(member)).target, 2630);
  writeTransaction(database, (scope) =>
    recomputeTarget(scope, admin.user, new Date(now), config.tdee, "weekly"),
  );
  const stored =
    "SELECT kcal, (SELECT count(*) FROM target_notices) FROM target_results";
  assert.deepEqual(database.prepare(stored).raw().all(), [[2130, 0]]);
});
