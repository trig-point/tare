import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import type { Database } from "better-sqlite3";
import { loadConfig } from "../src/config.ts";
import { writeTransaction } from "../src/db.ts";
import { createJobRunner } from "../src/jobs.ts";
import { selectTargetResult } from "../src/queries/select-target-result.ts";
import { readAdaptive } from "../src/target/adaptive.ts";
import { createTargetRecomputeJob } from "../src/target/job.ts";
import { liveFormula } from "../src/target/live-formula.ts";
import { readTarget } from "../src/target/reader.ts";
import { recomputeTarget } from "../src/target/recompute.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const config = loadConfig({ DATABASE_URL: ":memory:" });
const settings = config.tdee;
const now = new Date("2026-01-01T00:00:00.000Z");
const profile = {
  height_cm: 180,
  birth_date: "1986-01-01",
  sex: "male",
  activity_level: "moderate",
  goal_rate_kg_week: -0.25,
};
type Actor = Awaited<ReturnType<typeof twoUsers>>["admin"];
const save = async (actor: Actor, changes = {}) =>
  (
    await actor.request("/api/profile", {
      method: "POST",
      body: JSON.stringify({ ...profile, ...changes }),
    })
  ).status;
function weigh(
  database: Database,
  userId: number,
  clientId: string,
  day: string,
  kg = 80,
) {
  database
    .prepare(
      "INSERT INTO weights(user_id,client_id,day,measured_at,weight_kg,created_at) VALUES (?,?,?,?,?,?)",
    )
    .run([
      userId,
      clientId,
      day,
      `${day}T12:00:00.000Z`,
      kg,
      now.toISOString(),
    ]);
}
function seed(database: Database, userId: number) {
  for (let offset = 0; offset <= 28; offset++) {
    const day = new Date(Date.UTC(2025, 11, 3 + offset))
      .toISOString()
      .slice(0, 10);
    weigh(database, userId, `weight-${offset}`, day);
    if (!offset) continue;
    database
      .prepare(
        "INSERT INTO intake_entries(user_id,client_id,day,eaten_at,name,kcal,kcal_low,kcal_high,provenance,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        userId,
        `food-${offset}`,
        day,
        `${day}T12:00:00.000Z`,
        "Example meal",
        2675,
        2660,
        2705,
        "estimated",
        now.toISOString(),
        now.toISOString(),
      );
    database
      .prepare(
        "UPDATE days SET signed_off_at = ? WHERE user_id = ? AND day = ?",
      )
      .run(now.toISOString(), userId, day);
  }
}

test("stored targets: readiness, adaptive today, rollback, owner isolation, reset and final-input interleavings", async (context) => {
  const { database, admin, member } = await twoUsers(context, "fallback");
  const latest = () => selectTargetResult(database, { user_id: admin.user.id });
  const recompute = () =>
    writeTransaction(database, (scope) =>
      recomputeTarget(scope, admin.user, now, settings, "weekly"),
    );
  const today = async () =>
    (await (await admin.request("/api/today")).json()).target;
  assert.deepEqual(recompute(), { stored: false });
  assert.equal(await save(admin), 200);
  assert.equal(latest(), null);
  assert.equal((await today()).status, "needs_weigh_in");
  seed(database, admin.user.id);
  const first = await today();
  recompute();
  assert.deepEqual(
    [
      latest()?.kcal,
      latest()?.tdee_kcal,
      latest()?.low_kcal,
      latest()?.high_kcal,
    ],
    [2400, 2675, 2660, 2705],
  );
  assert.equal((await today()).protein_g, 128);
  const weekly = await today();
  assert.equal(await save(member), 200);
  assert.equal(
    readTarget(database, member.user, now, config).status,
    "needs_weigh_in",
  );
  weigh(database, member.user.id, "first", "2026-01-01", 50);
  assert.equal(
    await save(member, {
      height_cm: 160,
      sex: "female",
      activity_level: "sedentary",
      goal_rate_kg_week: -1.5,
    }),
    200,
  );
  const other = readTarget(database, member.user, now, config);
  for (const [target, kcal, basis] of [
    [first, 2410, "live_formula"],
    [weekly, 2400, "weekly_adaptive"],
    [other, -280, "weekly_formula"],
  ] as const) {
    assert.equal(target.status, "ready");
    assert.equal(target.kcal, kcal);
    assert.equal(target.basis, basis);
  }
  database
    .prepare(
      "UPDATE intake_entries SET kcal = kcal + 1 WHERE user_id = ? AND client_id = ?",
    )
    .run(admin.user.id, "food-28");
  database
    .prepare("UPDATE days SET signed_off_at = ? WHERE user_id = ? AND day = ?")
    .run(now.toISOString(), admin.user.id, "2025-12-31");
  recompute();
  const estimate = readAdaptive(database, admin.user, now, settings);
  assert.equal(estimate.status, "eligible");
  if (estimate.status !== "eligible") throw new Error("Expected estimate");
  assert.equal(latest()?.tdee_kcal, 2675 + 1 / 28);
  assert.deepEqual(
    [latest()?.tdee_kcal, latest()?.low_kcal, latest()?.high_kcal],
    [estimate.tdee_kcal, estimate.low_kcal, estimate.high_kcal],
  );
  let goal = -0.25;
  for (const actions of [
    ["weekly", "profile"],
    ["profile", "weekly"],
    ["profile", "weekly", "profile"],
  ] as const) {
    for (const action of actions) {
      goal = -goal;
      if (action === "weekly") {
        database
          .prepare(
            "UPDATE profiles SET goal_rate_kg_week = ? WHERE user_id = ?",
          )
          .run(goal, admin.user.id);
        recompute();
      } else assert.equal(await save(admin, { goal_rate_kg_week: goal }), 200);
      assert.equal(latest()?.trigger, action);
      assert.equal(
        latest()?.kcal,
        Math.round((estimate.tdee_kcal + goal * 1100) / 10) * 10,
      );
      const shown = await today();
      assert.deepEqual(
        [shown.kcal, shown.basis],
        [latest()?.kcal, "weekly_adaptive"],
      );
    }
  }
  assert.equal(latest()?.computed_at, now.toISOString());
  const previous = latest();
  database.exec(
    "CREATE TRIGGER reject_target AFTER INSERT ON target_results WHEN NEW.trigger = 'profile' BEGIN SELECT RAISE(ABORT, 'injected'); END",
  );
  assert.equal(await save(admin, { goal_rate_kg_week: 0 }), 500);
  assert.deepEqual(latest(), previous);
  assert.equal(
    (await (await admin.request("/api/profile")).json()).profile
      .goal_rate_kg_week,
    goal,
  );
  database.exec("DROP TRIGGER reject_target");
  database.prepare("DELETE FROM weights WHERE user_id = ?").run(admin.user.id);
  assert.equal((await today()).status, "needs_weigh_in");
  assert.equal(await save(admin, { goal_rate_kg_week: 0 }), 200);
  assert.equal(latest(), null);
  weigh(database, admin.user.id, "again", "2026-01-01");
  assert.equal((await today()).basis, "live_formula");
  const formula = liveFormula(database, admin.user, now);
  assert.equal(
    formula.status === "ready" && formula.kcal,
    (await today()).kcal,
  );
  recompute();
  assert.equal((await today()).basis, "weekly_formula");
  assert.equal(
    selectTargetResult(database, { user_id: member.user.id })?.kcal,
    -280,
  );
});

test("weekly job isolates a failed person, logs counts, records failure and fires on the local weekday", async (context) => {
  const { database, admin, member } = await twoUsers(context, "fallback");
  for (const actor of [admin, member]) {
    assert.equal(await save(actor), 200);
    seed(database, actor.user.id);
  }
  const errors: unknown[][] = [];
  context.mock.method(console, "error", (...args: unknown[]) =>
    errors.push(args),
  );
  database.exec(
    "CREATE TRIGGER fail_first BEFORE INSERT ON target_results WHEN NEW.user_id = (SELECT MIN(user_id) FROM profiles) BEGIN SELECT RAISE(ABORT, 'injected'); END",
  );
  const clock = { now: () => now };
  const runner = createJobRunner({
    database,
    timezone: "America/New_York",
    clock,
    report: () => assert.fail("Runner record failure"),
  });
  const job = createTargetRecomputeJob({
    database,
    clock,
    settings,
    weekday: 1,
  });
  runner.register(job);
  runner.start();
  const result = await runner.runNow(job.name);
  assert.equal(result?.status, "failed");
  assert.ok(result && "detail" in result && result.detail === "job_failed");
  assert.equal(selectTargetResult(database, { user_id: admin.user.id }), null);
  assert.ok(selectTargetResult(database, { user_id: member.user.id }));
  assert.ok(errors.some((args) => args[0] === "targets_recomputed:1 failed:1"));
  database.exec("DROP TRIGGER fail_first");
  assert.equal(
    ((await runner.runNow(job.name)) as { detail: string }).detail,
    "targets_recomputed:2",
  );
  await runner.stop();
  context.mock.timers.enable({
    apis: ["Date", "setTimeout"],
    now: new Date("2026-11-02T07:59:59.000Z"),
  });
  clock.now = () => new Date();
  const scheduled = createJobRunner({
    database,
    timezone: "America/New_York",
    clock,
    report: () => assert.fail("Scheduled record failure"),
  });
  let calls = 0;
  const entered = Promise.withResolvers<void>();
  scheduled.register({
    ...job,
    run: async (options) => {
      calls++;
      entered.resolve();
      return job.run(options);
    },
  });
  scheduled.start();
  try {
    context.mock.timers.tick(999);
    assert.equal(calls, 0);
    context.mock.timers.tick(1);
    await entered.promise;
    const readRun = () =>
      database
        .prepare<[string], { status: string }>(
          "SELECT status FROM job_runs WHERE job_name = ?",
        )
        .get(job.name);
    while (readRun()?.status === "running") await setImmediate();
    assert.equal(readRun()?.status, "ok");
    assert.equal(calls, 1);
    assert.equal(
      selectTargetResult(database, { user_id: admin.user.id })?.computed_at,
      "2026-11-02T08:00:00.000Z",
    );
  } finally {
    context.mock.timers.reset();
    await scheduled.stop();
  }
});

test("weekday config accepts names, resets empty values and selects each cron day", () => {
  for (const [index, name] of [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ].entries()) {
    const config = loadConfig({
      DATABASE_URL: ":memory:",
      TARE_TARGET_WEEKDAY: ` ${name.toUpperCase()} `,
    });
    assert.equal(config.targetWeekday, index);
    assert.equal(
      createTargetRecomputeJob({
        database: {} as Database,
        clock: { now: () => now },
        settings,
        weekday: config.targetWeekday,
      }).schedule,
      `0 3 * * ${index}`,
    );
  }
  for (const value of [undefined, "", " "])
    assert.equal(
      loadConfig({ DATABASE_URL: ":memory:", TARE_TARGET_WEEKDAY: value })
        .targetWeekday,
      1,
    );
  assert.throws(
    () => loadConfig({ DATABASE_URL: ":memory:", TARE_TARGET_WEEKDAY: "mon" }),
    /TARE_TARGET_WEEKDAY/,
  );
});

test("a week of activity bonuses leaves the estimate, stored target and notice unchanged", async (context) => {
  const { database, admin, member } = await twoUsers(context, "fallback");
  const people = [admin, member];
  for (const person of people) {
    assert.equal(await save(person), 200);
    seed(database, person.user.id);
  }
  for (let offset = 0; offset <= 35; offset++)
    database
      .prepare(
        "INSERT INTO daily_signals VALUES (?, date('2026-01-01', ?), 'active_calories', ?, 'oura', ?)",
      )
      .run(
        member.user.id,
        `-${offset} days`,
        offset < 7 ? 1200 : 430,
        now.toISOString(),
      );
  const bonused = readTarget(database, member.user, now, config);
  assert.equal(bonused.status === "ready" && bonused.bonus.kcal, 500);
  const weekly = people.map((person) => {
    writeTransaction(database, (scope) =>
      recomputeTarget(scope, person.user, now, settings, "weekly"),
    );
    const stored = selectTargetResult(database, {
      user_id: person.user.id,
    });
    return {
      stored: { ...stored, id: undefined },
      estimate: readAdaptive(database, person.user, now, settings),
      notices: database
        .prepare(
          "SELECT old_kcal, old_protein_g, new_kcal, new_protein_g FROM target_notices WHERE user_id = ?",
        )
        .all(person.user.id),
    };
  });
  assert.equal(weekly[0]?.notices.length, 1);
  assert.deepEqual(weekly[1], weekly[0]);
});
