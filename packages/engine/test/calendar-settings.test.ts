import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { inspect } from "node:util";
import {
  type CalendarInput,
  type CalendarResult,
  createCalendarEvaluator,
} from "../src/calendar/index.ts";
import { calendarOperations } from "../src/calendar/operations.ts";
import { createCalendarRefresher } from "../src/calendar/refresh.ts";
import { loadConfig } from "../src/config.ts";
import { writeTransaction } from "../src/db.ts";
import { insertIntake } from "../src/logging/intake.ts";
import { numbersFrom } from "../src/logging/schemas.ts";
import { agentOperations, operations } from "../src/operations/index.ts";
import { executeOperation } from "../src/operations/registry.ts";
import { selectedTemplate } from "../src/plan/reader.ts";
import type { planSchema } from "../src/plan/schema.ts";
import { commitCalendarCache } from "../src/queries/calendar/commit-calendar-cache.ts";
import { selectCalendarRules } from "../src/queries/calendar/select-calendar-rules.ts";
import { selectCalendarSettings } from "../src/queries/calendar/select-calendar-settings.ts";
import { accessConfig, dummyHash } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const until = async (condition: () => boolean) => {
  while (!condition()) await setImmediate();
};
async function setup(
  context: TestContext,
  mode: "fallback" | "access" = "fallback",
) {
  const users = await twoUsers(context, mode);
  const { database, admin } = users;
  database.exec("UPDATE users SET timezone = 'UTC', day_start_hour = 0");
  let now = new Date(
    mode === "access" ? "2026-01-01T00:00:00.000Z" : "2026-01-01T12:00:00.000Z",
  );
  users.setNow(now.toISOString());
  const clock = { now: () => now };
  const calls: {
    url: string;
    signal: AbortSignal;
    resolve(value: string | null): void;
    reject(error: Error): void;
  }[] = [];
  let evaluate: (input: CalendarInput) => Promise<CalendarResult> =
    async () => ({ status: "match", rule_index: 0 });
  const evaluator = {
    evaluate: (input: CalendarInput) => evaluate(input),
    close: async () => {},
  };
  const calendar = createCalendarRefresher({
    database,
    clock,
    evaluator,
    transport: (url, signal) => {
      assert.equal(database.inTransaction, false);
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => resolve(null), { once: true });
        calls.push({ url, signal, resolve, reject });
      });
    },
  });
  context.after(() => calendar.stop());
  const deps = {
    database,
    clock,
    calendar,
    config:
      mode === "access"
        ? accessConfig
        : loadConfig({ DATABASE_URL: ":memory:" }),
    dummyHash,
    verifyPassword: async () => false,
    signInLimiter: { waiting: 0 },
  };
  const bodies: unknown[] = [];
  const run = async (
    name: string,
    input: unknown,
    person = admin.user,
    credential: "session" | "service" = "session",
  ) => {
    const operation = operations.find((item) => item.name === name);
    assert.ok(operation);
    const result = await executeOperation(
      operation,
      input,
      { person: { ...person, timezone: "UTC", day_start_hour: 0 }, credential },
      deps,
    );
    bodies.push(result.body);
    return result;
  };
  const types: number[] = [];
  for (let index = 0; index < 3; index++) {
    const template = (
      await run("save_day_template", {
        action: "create",
        name: `Example ${index}`,
        slots: [
          { name: "Example", start_minute: 0, end_minute: 1440, share: 100 },
        ],
      })
    ).body as { template: { id: number } };
    const body = (
      await run("save_day_type", {
        action: "create",
        name: `Example ${index}`,
        template_id: template.template.id,
      })
    ).body as { day_type: { id: number } };
    types.push(body.day_type.id);
  }
  const rule = { keyword: "office", day_type_id: types[1] as number };
  const save = (extra = {}, person = admin.user) =>
    run(
      "save_calendar_settings",
      {
        enabled: true,
        feed_url: "https://feed.example.test/private-a",
        rules: [rule],
        ...extra,
      },
      person,
    );
  const rows = () =>
    database
      .prepare("SELECT * FROM calendar_cache ORDER BY user_id, day")
      .all();
  return {
    ...users,
    clock,
    calendar,
    calls,
    run,
    save,
    rows,
    types,
    rule,
    bodies,
    settings: async () =>
      (await run("read_calendar_settings", {})).body as {
        configured: boolean;
        status: string;
        checked_at?: string;
        day_type_id?: number;
      },
    person: { ...admin.user, timezone: "UTC", day_start_hour: 0 },
    setTime(value: string) {
      now = new Date(value);
      users.setNow(value);
    },
    result(value: CalendarResult) {
      evaluate = async () => value;
    },
    useEvaluator(value: typeof evaluate) {
      evaluate = value;
    },
  };
}

test("calendar selection: manual first, exact cache key and expiry, plan, item, intake and budgets agree", async (context) => {
  const state = await setup(context);
  const { database, person, types, run, rows } = state;
  await run("set_default_day_type", { day_type_id: types[0] });
  await run("save_profile", {
    height_cm: 180,
    birth_date: "1986-01-01",
    sex: "male",
    activity_level: "moderate",
    goal_rate_kg_week: -0.5,
  });
  await run("log_weight", { client_id: "example-weight", weight_kg: 80 });
  const read = async () =>
    (await run("read_plan", {})).body as ReturnType<typeof planSchema.parse>;
  const log = (client_id: string, eaten_at?: string, clock = state.clock) =>
    writeTransaction(database, (scope) =>
      insertIntake(
        scope,
        person,
        {
          client_id,
          eaten_at,
          name: "Example",
          numbers: numbersFrom({ kcal: 100, protein_g: 20 }),
          claim: {},
        },
        clock,
      ),
    );
  await state.save();
  await until(() => state.calls.length === 1);
  const pending = await read();
  assert.equal(pending.budgets.status, "ready");
  assert.equal(pending.day_type?.id, types[0]);
  assert.equal(log("held-fetch").entry.slot_template_id, pending.template?.id);
  state.calls[0]?.resolve("invented feed");
  await until(() => rows().length === 1);
  const select = (day = "2026-01-01", owner = person) =>
    selectedTemplate(database, owner, day, state.clock.now());
  assert.equal(select().day_type?.id, types[1]);
  const plan = await read();
  assert.equal(plan.budgets.status, "ready");
  assert.deepEqual(plan.budgets.target, pending.budgets.target);
  assert.equal(plan.budgets.slots[0]?.kcal.intake, 100);
  assert.equal(plan.budgets.slots[0]?.kcal.budget, plan.budgets.target?.kcal);
  const food_id = Number(
    database
      .prepare(
        "INSERT INTO foods (user_id, name, kcal, provenance) VALUES (?, 'Example', 100, 'estimated')",
      )
      .run(person.id).lastInsertRowid,
  );
  const planned = (await run("plan_slot", { food_id, position: 0 })).body as {
    item: { template_id: number };
  };
  assert.equal(planned.item.template_id, plan.template?.id);
  assert.equal(log("calendar-match").entry.slot_template_id, plan.template?.id);
  await run("set_day_type", { day_type_id: types[2] });
  assert.equal(select().day_type?.id, types[2]);
  database.exec("DELETE FROM day_type_choices");
  state.setTime("2026-01-01T12:59:59.999Z");
  assert.equal(select().day_type?.id, types[1]);
  state.setTime("2026-01-01T13:00:00.000Z");
  assert.equal(select().day_type?.id, types[0]);
  state.setTime("2026-01-01T12:30:00.000Z");
  for (const owner of [
    { ...person, timezone: "Asia/Tokyo" },
    { ...person, day_start_hour: 1 },
  ])
    assert.equal(select(undefined, owner).day_type?.id, types[0]);
  assert.equal(select("2025-12-31").day_type?.id, types[0]);
  assert.equal(select("2026-01-02").day_type?.id, types[0]);
  assert.equal(
    select(undefined, { ...person, id: state.member.user.id }).day_type,
    null,
  );
  for (const status of ["no_match", "unavailable"] as const) {
    database
      .prepare("UPDATE calendar_cache SET status = ?, day_type_id = NULL")
      .run(status);
    assert.equal(select().day_type?.id, types[0]);
    assert.equal((await read()).budgets.status, "ready");
    assert.equal(log(status).entry.slot_template_id, pending.template?.id);
  }
  database
    .prepare("UPDATE calendar_cache SET status = 'match', day_type_id = ?")
    .run(types[1]);
  database.exec("UPDATE calendar_settings SET revision = revision + 1");
  assert.equal(select().day_type?.id, types[0]);
  database.exec("DELETE FROM calendar_cache");
  assert.equal(select().day_type?.id, types[0]);
  commitCalendarCache(database, {
    user_id: person.id,
    day: "2026-01-01",
    timezone: "UTC",
    day_start_hour: 0,
    revision: 2,
    status: "match",
    day_type_id: types[1] as number,
    fetched_at: "2026-01-01T23:45:00.000Z",
  });
  state.setTime("2026-01-02T00:30:00.000Z");
  let clockReads = 0;
  const writeClock = {
    now: () => {
      clockReads++;
      return state.clock.now();
    },
  };
  assert.equal(
    log("backdated", "2026-01-01T12:00:00.000Z", writeClock).entry
      .slot_template_id,
    plan.template?.id,
  );
  assert.equal(clockReads, 1);
  state.setTime("2026-01-02T00:45:00.000Z");
  assert.equal(
    log("backdated-expired", "2026-01-01T12:00:00.000Z").entry.slot_template_id,
    pending.template?.id,
  );
});

test("settings validation is bounded and saves retain URLs, bump revisions, clear cache and reset on disable", async (context) => {
  const state = await setup(context);
  const { database, admin, member, save, rule, rows } = state;
  assert.deepEqual(await state.settings(), {
    configured: false,
    rules: [],
    status: "not_configured",
  });
  for (const [extra, code] of [
    ...[
      "http://feed.example.test/",
      "https://user:pass@feed.example.test/",
      "https://feed.example.test/#secret",
      "https://feed.example.test/#",
      "broken",
      "https://feed.example.test:444/",
    ].map((feed_url) => [{ feed_url }, "invalid_feed_url"]),
    ...["", "two words"].map((keyword) => [
      { rules: [{ ...rule, keyword }] },
      "invalid_keyword",
    ]),
    [{ rules: [{ ...rule, day_type_id: 99999 }] }, "not_found"],
    [{ user_id: member.user.id }, "invalid_request"],
    [{ feed_url: "x".repeat(2049) }, "invalid_request"],
    [{ rules: Array(21).fill(rule) }, "invalid_request"],
  ] as const)
    await assert.rejects(save(extra), { code });
  const snapshots = () =>
    selectCalendarSettings(database, { user_id: admin.user.id });
  await save({ rules: [rule, rule] });
  await until(() => state.calls.length === 1);
  assert.equal((await state.settings()).status, "pending");
  state.calls[0]?.resolve("feed");
  await until(() => rows().length === 1);
  assert.deepEqual(await state.settings(), {
    configured: true,
    rules: [rule, rule],
    status: "match",
    day_type_id: rule.day_type_id,
    checked_at: state.clock.now().toISOString(),
  });
  state.setTime("2026-01-01T13:00:00.000Z");
  assert.equal((await state.settings()).status, "pending");
  assert.ok((await state.settings()).checked_at);
  const initial = snapshots();
  for (const [extra, status] of [
    [{}, "no_match"],
    [{ feed_url: undefined }, "unavailable"],
  ] as const) {
    state.result({ status });
    const index = state.calls.length;
    await save(extra);
    assert.equal(rows().length, 0);
    await until(() => state.calls.length > index);
    state.calls[index]?.resolve("feed");
    await until(() => rows().length === 1);
    assert.equal((await state.settings()).status, status);
    assert.equal((await state.settings()).day_type_id, undefined);
  }
  assert.equal(snapshots()?.feed_url, initial?.feed_url);
  assert.equal(snapshots()?.revision, (initial?.revision as number) + 2);
  const before = snapshots()?.revision as number;
  await save({ enabled: false, feed_url: undefined, rules: [] });
  assert.equal(snapshots()?.feed_url, null);
  assert.deepEqual(
    selectCalendarRules(database, { user_id: admin.user.id }),
    [],
  );
  assert.equal(rows().length, 0);
  assert.deepEqual(await state.settings(), {
    configured: false,
    rules: [],
    status: "not_configured",
  });
  await save();
  assert.equal(snapshots()?.revision, before + 2);
});

for (const mode of ["fallback", "access"] as const)
  test(`${mode}: both owners' URLs and feed contents stay private across browser, status, cache, job and error outputs`, async (context) => {
    const state = await setup(context, mode);
    const { database, admin, member, save, run, rule, rows, bodies } = state;
    const logs = ["log", "warn", "error", "info"].map((name) =>
      context.mock.method(console, name as "log", () => {}),
    );
    const secrets = [
      "https://feed.example.test/private-a",
      "https://feed.example.test/private-b",
      "private title",
    ];
    await save();
    await until(() => state.calls.length === 1);
    await assert.rejects(save({}, member.user), { code: "not_found" });
    await assert.rejects(
      save({ user_id: admin.user.id, rules: [] }, member.user),
      { code: "invalid_request" },
    );
    assert.deepEqual(
      selectCalendarRules(database, { user_id: admin.user.id }),
      [rule],
    );
    await save({ feed_url: secrets[1], rules: [] }, member.user);
    await until(() => state.calls.length === 2);
    assert.deepEqual(
      state.calls.map((call) => call.url),
      secrets.slice(0, 2),
    );
    state.calls[0]?.reject(new Error(`network failed ${secrets[0]}`));
    state.calls[1]?.resolve(null);
    await until(() => rows().length === 2);
    assert.equal((await state.settings()).status, "unavailable");
    const real = createCalendarEvaluator();
    context.after(() => real.close());
    state.useEvaluator(real.evaluate);
    await save();
    await until(() => state.calls.length === 3);
    state.calls[2]?.resolve(`private title ${secrets[0]}`);
    await until(() => rows().length === 2);
    assert.equal((await state.settings()).status, "unavailable");
    for (const operation of calendarOperations)
      await assert.rejects(
        run(
          operation.name,
          operation.method === "GET" ? {} : { enabled: false, rules: [] },
          admin.user,
          "service",
        ),
        { code: "forbidden" },
      );
    assert.equal(
      agentOperations.some((item) => item.name.includes("calendar")),
      false,
    );
    for (const owner of [admin, member])
      for (const path of [
        "/api/me",
        "/api/session",
        "/api/calendar/settings",
        "/api/plan",
        "/api/today",
      ]) {
        const response = await owner.request(path);
        assert.equal(response.status, 200, `${mode} ${path}`);
        bodies.push(await response.json());
      }
    bodies.push(state.calendar.job.run());
    const captured = inspect(
      [
        bodies,
        logs.flatMap((logger) =>
          logger.mock.calls.map((call) => call.arguments),
        ),
        rows(),
      ],
      { depth: null },
    );
    for (const secret of secrets)
      assert.equal(captured.includes(secret), false, secret);
  });
