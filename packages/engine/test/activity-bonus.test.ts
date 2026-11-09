import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { shiftDay } from "../src/logging/day.ts";
import { readTarget } from "../src/target/reader.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const config = loadConfig({ DATABASE_URL: ":memory:" });
const now = "2026-01-01T15:00:00.000Z";
const today = "2026-01-01";
const usual = Array<number | null>(28).fill(430);

async function setup(context: Parameters<typeof twoUsers>[0]) {
  const fixture = await twoUsers(context, "fallback");
  const { database, admin, member } = fixture;
  fixture.setNow(now);
  const post = async (person: typeof admin, path: string, body: unknown) => {
    const response = await person.request(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    assert.ok(response.ok, path);
    return response.json();
  };
  for (const person of [admin, member]) {
    await post(person, "/api/profile", {
      height_cm: 180,
      birth_date: "1986-01-01",
      sex: "male",
      activity_level: "moderate",
      goal_rate_kg_week: -0.5,
    });
    await post(person, "/api/weights", { client_id: "weight", weight_kg: 80 });
  }
  database.exec(
    "INSERT INTO target_results (user_id, computed_at, trigger, kcal, protein_g, basis) SELECT id, '2025-12-29T08:00:00.000Z', 'weekly', 2180, 128, 'formula' FROM users",
  );
  database
    .prepare(
      "INSERT INTO oura_connections (user_id, version, ciphertext, iv, tag, access_expires_at, scopes, scope_source, status, generation, last_synced_at, created_at, updated_at) VALUES (?, 1, 'x', 'x', 'x', ?, 'daily', 'requested', 'connected', 1, ?, ?, ?)",
    )
    .run(admin.user.id, ...Array(4).fill(now));
  const insert = database.prepare(
    "INSERT OR REPLACE INTO daily_signals VALUES (?, ?, ?, ?, ?, ?)",
  );
  // history[0] is the day before `day`.
  const burn = (
    day: string,
    value: number | null,
    history: (number | null)[] = [],
    { source = "oura", metric = "active_calories", user = admin.user.id } = {},
  ) => {
    for (const [index, past] of [value, ...history].entries())
      if (past !== null)
        insert.run(user, shiftDay(day, -index), metric, past, source, now);
  };
  const read = (mode: "same-day" | "next-day" = "same-day") => {
    const target = readTarget(database, admin.user, new Date(now), {
      ...config,
      activityCredit: mode,
    });
    assert.equal(target.status, "ready");
    return target;
  };
  return { ...fixture, post, burn, read };
}

test("bonus: training, quiet, next-day, waiting, no source, cap, fractional mean and window", async (context) => {
  const { database, burn, read } = await setup(context);
  const alternating = Array(14).fill([430, 431.2]).flat();
  const gaps = [...Array(14).fill([400, null]).flat(), 9000];
  for (const [mode, history, credited, expected] of [
    ["same-day", usual, 680, "2430 ready 250 680 430"],
    ["same-day", usual, 120, "2180 ready 0 120 430"],
    ["next-day", usual, 680, "2430 ready 250 680 430"],
    ["same-day", usual, null, "2180 waiting 0 null 430"],
    ["next-day", usual, null, "2180 waiting 0 null 430"],
    ["same-day", usual.slice(0, 9), null, "2180 no_source 0 null null"],
    ["same-day", usual, 1630, "2680 ready 500 capped 1630 430"],
    ["same-day", alternating, 680, "2429 ready 249 680 430.6"],
    ["same-day", gaps, 700, "2480 ready 300 700 400"],
  ] as const) {
    database.prepare("DELETE FROM daily_signals").run();
    const day = mode === "same-day" ? today : shiftDay(today, -1);
    burn(day, credited, [...history]);
    if (mode === "next-day") burn(today, 1500);
    const { kcal, base_kcal, bonus } = read(mode);
    const average =
      bonus.average_kcal && Math.round(bonus.average_kcal * 10) / 10;
    assert.equal(
      `${kcal} ${bonus.status} ${bonus.kcal}${bonus.capped ? " capped" : ""} ${bonus.burn_kcal} ${average}`,
      expected,
    );
    assert.deepEqual([base_kcal, bonus.mode, bonus.day], [2180, mode, day]);
  }
  assert.equal(read().bonus.last_synced_at, now);
});

test("guard: hand-entered burn, HRV, sleep, sessions, session calories and habit notes never change the target", async (context) => {
  const { admin, burn, post, read } = await setup(context);
  for (const source of ["manual", "agent"])
    burn(today, 2600, usual, { source });
  await post(admin, "/api/signals", { metric: "active_calories", value: 2900 });
  assert.deepEqual([read().kcal, read().bonus.status], [2180, "no_source"]);
  burn(today, 680, usual);
  const before = read();
  assert.equal(before.kcal, 2430);
  for (const metric of ["hrv", "sleep", "resting_heart_rate", "steps"])
    burn(today, 9000, Array(28).fill(50), { metric });
  for (const [path, body] of [
    ["/api/signals", { metric: "active_calories", value: 3000 }],
    ["/api/signals", { metric: "hrv", value: 15 }],
    ["/api/habits", { habit_key: "evening_alcohol", amount: 3 }],
    [
      "/api/activities",
      {
        started_at: "2026-01-01T13:00:00.000Z",
        duration_minutes: 90,
        kind: "strength",
        calories: 900,
      },
    ],
  ] as const)
    await post(admin, path, body);
  assert.deepEqual(read(), before);
});

test("slots: open slots move, ended slots keep their budgets, remaining uses the total; two users", async (context) => {
  const { admin, member, burn, post } = await setup(context);
  const { template } = await post(admin, "/api/plan/templates", {
    action: "create",
    name: "Example template",
    slots: [0, 1, 2, 3].map((position) => ({
      name: `Example slot ${position + 1}`,
      start_minute: position * 360,
      end_minute: (position + 1) * 360,
      share: 25,
    })),
  });
  const type = await post(admin, "/api/plan/day-types", {
    action: "create",
    name: "Example type",
    template_id: template.id,
  });
  await post(admin, "/api/plan/default-day-type", {
    day_type_id: type.day_type.id,
  });
  const read = async (person = admin) => {
    const get = async (path: string) => (await person.request(path)).json();
    const [plan, day] = [await get("/api/plan/today"), await get("/api/today")];
    const budgets = plan.budgets.slots.map(
      (slot: { kcal: { budget: number } }) => slot.kcal.budget,
    );
    return { budgets, target: day.target.kcal, left: day.remaining.kcal };
  };
  const before = await read();
  burn(today, 680, Array(14).fill([430, 431.2]).flat());
  const after = await read();
  const open = (budgets: number[]) =>
    budgets.slice(2).reduce((sum, value) => sum + value);
  assert.deepEqual(after.budgets.slice(0, 2), before.budgets.slice(0, 2));
  assert.equal(open(after.budgets) - open(before.budgets), 249);
  assert.ok(after.budgets.every(Number.isInteger));
  assert.deepEqual([after.target, after.left], [2429, 2429]);
  burn(today, 1500, Array(28).fill(100), { user: member.user.id });
  assert.deepEqual(await read(), after);
  assert.equal((await read(member)).target, 2680);
});
