import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import {
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
import { commitCalendarCache } from "../src/queries/calendar/commit-calendar-cache.ts";
import { selectCalendarRules } from "../src/queries/calendar/select-calendar-rules.ts";
import { selectCalendarSettings } from "../src/queries/calendar/select-calendar-settings.ts";
import { insertAccount } from "../src/queries/insert-account.ts";
import { dummyHash } from "./auth-support.ts";
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
  let now = new Date("2026-01-01T12:00:00.000Z");
  users.setNow(now.toISOString());
  const clock = { now: () => now };
  const calls: {
    url: string;
    signal: AbortSignal;
    resolve(value: string | null): void;
  }[] = [];
  let result: CalendarResult = { status: "match", rule_index: 0 };
  const evaluator = { evaluate: async () => result, close: async () => {} };
  const calendar = createCalendarRefresher({
    database,
    clock,
    evaluator,
    transport: (url, signal) => {
      assert.equal(database.inTransaction, false);
      return new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve(null), { once: true });
        calls.push({ url, signal, resolve });
      });
    },
  });
  context.after(() => calendar.stop());
  const deps = {
    database,
    clock,
    calendar,
    config: loadConfig({ DATABASE_URL: ":memory:" }),
    dummyHash,
    verifyPassword: async () => false,
    signInLimiter: { waiting: 0 },
  };
  const run = async (
    name: string,
    input: unknown,
    person = admin.user,
    credential: "session" | "service" = "session",
  ) => {
    const operation = operations.find((item) => item.name === name);
    assert.ok(operation);
    return executeOperation(
      operation,
      input,
      { person: { ...person, timezone: "UTC", day_start_hour: 0 }, credential },
      deps,
    );
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
      .all() as {
      revision: number;
      day: string;
      status: string;
      day_type_id: number | null;
    }[];
  return {
    ...users,
    clock,
    calendar,
    calls,
    evaluator,
    run,
    save,
    rows,
    types,
    rule,
    deps,
    person: { ...admin.user, timezone: "UTC", day_start_hour: 0 },
    setTime(value: string) {
      now = new Date(value);
      users.setNow(value);
    },
    result(value: CalendarResult) {
      result = value;
    },
  };
}

test("calendar selection: manual first, exact cache key and expiry, plan, item, intake and budgets agree", async (context) => {
  const state = await setup(context);
  const { database, person, types, run, rows, rule } = state;
  await run("set_default_day_type", { day_type_id: types[0] });
  await state.save();
  await until(() => state.calls.length === 1);
  state.calls[0]?.resolve("invented feed");
  await until(() => rows().length === 1);
  const select = (day = "2026-01-01", owner = person) =>
    selectedTemplate(database, owner, day, state.clock.now());
  assert.equal(select().day_type?.id, types[1]);
  const plan = (await run("read_plan", {})).body as {
    template: { id: number };
    budgets: { status: string };
  };
  assert.equal(plan.budgets.status, "needs_profile");
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
  assert.equal(planned.item.template_id, plan.template.id);
  const logged = writeTransaction(database, (scope) =>
    insertIntake(
      scope,
      person,
      {
        client_id: "example-calendar",
        name: "Example",
        numbers: numbersFrom({ kcal: 100 }),
        claim: {},
      },
      state.clock,
    ),
  );
  assert.equal(logged.entry.slot_template_id, plan.template.id);
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
  for (const status of ["no_match", "unavailable"] as const) {
    database
      .prepare("UPDATE calendar_cache SET status = ?, day_type_id = NULL")
      .run(status);
    assert.equal(select().day_type?.id, types[0]);
  }
  database.exec("UPDATE calendar_settings SET revision = revision + 1");
  assert.equal(select().day_type?.id, types[0]);
  database.exec("DELETE FROM calendar_cache");
  assert.equal(select().day_type?.id, types[0]);
  assert.equal(rule.day_type_id, types[1]);
});

for (const mode of ["fallback", "access"] as const)
  test(`${mode}: settings validation, reset, owned FKs, secret reads and browser-only operations`, async (context) => {
    const state = await setup(context, mode);
    const { database, admin, member, save, run, rule, rows } = state;
    const logs = ["log", "warn", "error", "info"].map((name) =>
      context.mock.method(console, name as "log", () => {}),
    );
    const bodies: unknown[] = [];
    assert.equal(
      (await run("read_calendar_settings", {})).body && rows().length,
      0,
    );
    for (const [extra, code] of [
      ...[
        "http://feed.example.test/",
        "https://user:pass@feed.example.test/",
        "https://feed.example.test/#secret",
        "broken",
        "https://feed.example.test:444/",
      ].map((feed_url) => [{ feed_url }, "invalid_feed_url"]),
      [{ rules: [{ ...rule, keyword: "" }] }, "invalid_keyword"],
      [{ rules: [{ ...rule, keyword: "two words" }] }, "invalid_keyword"],
      [{ rules: [{ ...rule, day_type_id: 99999 }] }, "not_found"],
      [{ user_id: member.user.id }, "invalid_request"],
      [{ feed_url: "x".repeat(2049) }, "invalid_request"],
      [{ rules: Array(21).fill(rule) }, "invalid_request"],
    ] as const)
      await assert.rejects(save(extra), { code });
    await save({ rules: [rule, rule] });
    await until(() => state.calls.length === 1);
    state.calls[0]?.resolve(null);
    await until(() => rows().length === 1);
    bodies.push((await run("read_calendar_settings", {})).body);
    assert.equal((bodies.at(-1) as { status: string }).status, "unavailable");
    const initial = selectCalendarSettings(database, {
      user_id: admin.user.id,
    });
    assert.ok(initial);
    await save({ feed_url: undefined });
    assert.equal(
      selectCalendarSettings(database, { user_id: admin.user.id })?.feed_url,
      initial.feed_url,
    );
    await until(() => state.calls.length === 2);
    state.calls[1]?.resolve(null);
    await until(() => rows().length === 1);
    const before = selectCalendarSettings(database, { user_id: admin.user.id })
      ?.revision as number;
    await save({ enabled: false, feed_url: undefined, rules: [] });
    assert.deepEqual(
      selectCalendarRules(database, { user_id: admin.user.id }),
      [],
    );
    assert.equal(rows().length, 0);
    assert.equal(
      selectCalendarSettings(database, { user_id: admin.user.id })?.feed_url,
      null,
    );
    await save();
    assert.equal(
      selectCalendarSettings(database, { user_id: admin.user.id })?.revision,
      before + 2,
    );
    for (const day_type_id of [rule.day_type_id, 99999])
      assert.throws(
        () =>
          database
            .prepare("INSERT INTO calendar_rules VALUES (?, 0, 'other', ?)")
            .run(member.user.id, day_type_id),
        { code: "SQLITE_CONSTRAINT_FOREIGNKEY" },
      );
    await assert.rejects(
      run("save_day_type", { action: "delete", id: rule.day_type_id }),
      { code: "day_type_in_use" },
    );
    await assert.rejects(save({}, member.user), { code: "not_found" });
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
      ])
        bodies.push(await (await owner.request(path)).json());
    const real = createCalendarEvaluator();
    bodies.push(
      await real.evaluate({
        feed_text: "private title https://feed.example.test/private-a",
        timezone: "UTC",
        day_start_hour: 0,
        day: "2026-01-01",
        keywords: ["office"],
      }),
    );
    await real.close();
    const captured = JSON.stringify([
      bodies,
      logs.flatMap((logger) => logger.mock.calls.map((call) => call.arguments)),
      rows(),
    ]);
    for (const secret of [
      "https://feed.example.test/private-a",
      "https://feed.example.test/private-b",
      "private title",
    ])
      assert.equal(captured.includes(secret), false);
  });
