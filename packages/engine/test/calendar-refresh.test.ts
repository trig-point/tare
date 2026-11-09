import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { CalendarResult } from "../src/calendar/index.ts";
import { writeTransaction } from "../src/db.ts";
import {
  type CommitCalendarCacheParams,
  commitCalendarCache,
} from "../src/queries/calendar/commit-calendar-cache.ts";
import { deleteCalendarCache } from "../src/queries/calendar/delete-calendar-cache.ts";
import { deleteCalendarRules } from "../src/queries/calendar/delete-calendar-rules.ts";
import { insertCalendarRule } from "../src/queries/calendar/insert-calendar-rule.ts";
import { saveCalendarSettings } from "../src/queries/calendar/save-calendar-settings.ts";
import { selectCalendarCache } from "../src/queries/calendar/select-calendar-cache.ts";
import { selectCalendarSettings } from "../src/queries/calendar/select-calendar-settings.ts";
import { insertAccount } from "../src/queries/insert-account.ts";
import { insertDayTemplate } from "../src/queries/insert-day-template.ts";
import { insertDayType } from "../src/queries/insert-day-type.ts";
import { cookie, fixture, requestedWith } from "./auth-support.ts";
import { calendarFakes, until } from "./support/calendar-fakes.ts";
import { test } from "./support/hang-ceiling.ts";

function setup(context: TestContext) {
  const original = fixture(context),
    { database } = original;
  let now = new Date("2026-01-01T12:00:00.000Z");
  const clock = { now: () => now };
  const people = [original.admin.id];
  for (const username of ["example-second", "example-third"]) {
    const person = insertAccount(database, {
      username,
      password_hash: "example-hash",
      access_email: null,
      timezone: "UTC",
      is_admin: 0,
      created_at: now.toISOString(),
    });
    assert.ok(person);
    people.push(person.id);
  }
  database.exec("UPDATE users SET timezone = 'UTC', day_start_hour = 0");
  const types = people.map((user_id) => {
    const template = insertDayTemplate(database, {
      user_id,
      name: "Example",
      created_at: now.toISOString(),
    });
    assert.ok(template);
    const dayType = insertDayType(database, {
      user_id,
      name: "Example",
      template_id: template.id,
    });
    assert.ok(dayType);
    return dayType.id;
  });
  const save = (owner = 0, enabled = true) =>
    writeTransaction(database, () => {
      const key = { user_id: people[owner] as number };
      saveCalendarSettings(database, {
        ...key,
        feed_url: enabled ? `https://feed.example.test/${owner}` : null,
        enabled: Number(enabled),
        now: now.toISOString(),
      });
      deleteCalendarRules(database, key);
      deleteCalendarCache(database, key);
      if (enabled)
        insertCalendarRule(database, {
          ...key,
          position: 0,
          keyword: "office",
          day_type_id: types[owner] as number,
        });
    });
  people.forEach((_person, owner) => save(owner));
  const { calendar, calls, closed, changes, useEvaluator } = calendarFakes(
    context,
    database,
    clock,
  );
  const enqueue = (owner = 0) => calendar.enqueue(people[owner] as number);
  const rows = () =>
    database
      .prepare(
        "SELECT user_id, day, timezone, day_start_hour, revision, status, fetched_at FROM calendar_cache ORDER BY user_id, day",
      )
      .all() as Omit<CommitCalendarCacheParams, "day_type_id">[];
  const cache = (day: string, owner = 0) => ({
    user_id: people[owner] as number,
    day,
    timezone: "UTC",
    day_start_hour: 0,
    revision: selectCalendarSettings(database, {
      user_id: people[owner] as number,
    })?.revision as number,
    status: "no_match",
    day_type_id: null,
    fetched_at: now.toISOString(),
  });
  return {
    ...original,
    calendar,
    clock,
    people,
    types,
    save,
    enqueue,
    calls,
    rows,
    cache,
    closed,
    changes,
    evaluate: useEvaluator,
    setTime(value: string) {
      now = new Date(value);
    },
    async called(count: number) {
      await until(() => calls.length >= count);
    },
  };
}

test("startup and hourly calendar job enqueue every configured owner without waiting for fetches", async (context) => {
  const state = setup(context);
  state.save(2, false);
  assert.equal(state.calendar.start(), "calendar_queued");
  await state.called(2);
  state.calls.forEach((call) => call.resolve("feed"));
  await until(() => state.rows().length === 2);
  assert.equal(state.changes(), 2);
  state.setTime("2026-01-01T12:30:00.000Z");
  assert.equal(state.calendar.job.run(), "calendar_queued");
  await state.called(4);
  state.calls.slice(2).forEach((call) => call.resolve("feed"));
  await until(() =>
    state
      .rows()
      .every((row) => row.fetched_at === state.clock.now().toISOString()),
  );
  assert.deepEqual(
    state.rows().map((row) => row.user_id),
    state.people.slice(0, 2),
  );
});

test("three saves while revision 5 runs coalesce to revision 7 and never commit stale results", async (context) => {
  const state = setup(context);
  for (let count = 0; count < 4; count++) state.save();
  state.enqueue();
  await state.called(1);
  for (let count = 0; count < 2; count++) {
    state.save();
    state.enqueue();
  }
  state.calls[0]?.resolve("old feed");
  await state.called(2);
  assert.deepEqual(state.rows(), []);
  state.calls[1]?.resolve("new feed");
  await until(() => state.rows().length === 1);
  assert.equal(state.rows()[0]?.revision, 7);
  assert.equal(state.calls.length, 2);
});

test("commit rechecks disabled and re-enabled settings, timezone, start hour and current day", async (context) => {
  const state = setup(context);
  for (const change of [
    () => {
      state.save(0, false);
      state.save();
    },
    () =>
      state.database
        .prepare("UPDATE users SET timezone = ? WHERE id = ?")
        .run("Asia/Tokyo", state.people[0]),
    () =>
      state.database
        .prepare("UPDATE users SET day_start_hour = ? WHERE id = ?")
        .run(4, state.people[0]),
    () => state.setTime("2026-01-02T12:00:00.000Z"),
  ]) {
    const previous = state.calls.length;
    state.save();
    state.enqueue();
    await state.called(previous + 1);
    change();
    state.enqueue();
    state.calls[previous]?.resolve("old feed");
    await state.called(previous + 2);
    assert.deepEqual(state.rows(), []);
    state.calls[previous + 1]?.resolve("new feed");
    await until(() => state.rows().length === 1);
  }
  assert.deepEqual(
    state.rows().map((row) => [row.day, row.timezone, row.day_start_hour]),
    [["2026-01-02", "Asia/Tokyo", 4]],
  );
});

test("two held evaluations preserve HTTP responsiveness, queued saves read latest settings, and dirty owners requeue fairly", async (context) => {
  const state = setup(context),
    evaluations: ((result: CalendarResult) => void)[] = [];
  state.evaluate(() => new Promise((resolve) => evaluations.push(resolve)));
  state.people.forEach((_person, owner) => state.enqueue(owner));
  await state.called(2);
  state.calls.forEach((call) => call.resolve("feed"));
  await until(() => evaluations.length >= 2);
  assert.equal((await state.app.request("/health")).status, 200);
  assert.equal(state.calls.length, 2);
  state.save(2);
  state.enqueue(2);
  state.save();
  state.enqueue();
  evaluations[0]?.({ status: "no_match" });
  await state.called(3);
  assert.equal(state.calls[2]?.url, "https://feed.example.test/2");
  state.evaluate(async () => ({ status: "no_match" }));
  state.calls[2]?.resolve("latest feed");
  await state.called(4);
  assert.equal(state.calls[3]?.url, "https://feed.example.test/0");
  state.calls[3]?.resolve("latest feed");
  evaluations[1]?.({ status: "no_match" });
  await until(() => state.rows().length === 3);
  assert.deepEqual(
    state.rows().map((row) => row.revision),
    [2, 1, 2],
  );
});

test("one owner's transport failure does not stop another, commits prune only that owner's old days, and a failed commit is logged", async (context) => {
  const state = setup(context);
  state.setTime("2026-01-04T12:00:00.000Z");
  for (const day of ["2026-01-01", "2026-01-02"])
    commitCalendarCache(state.database, state.cache(day));
  commitCalendarCache(state.database, state.cache("2026-01-01", 2));
  state.enqueue();
  state.enqueue(1);
  await state.called(2);
  state.calls[0]?.reject(new Error("invented network failure"));
  state.calls[1]?.resolve("feed");
  await until(
    () => state.rows().filter((row) => row.day === "2026-01-04").length === 2,
  );
  assert.equal(
    selectCalendarCache(state.database, state.cache("2026-01-01")),
    null,
  );
  assert.ok(selectCalendarCache(state.database, state.cache("2026-01-02")));
  assert.ok(selectCalendarCache(state.database, state.cache("2026-01-01", 2)));
  assert.deepEqual(
    state
      .rows()
      .filter((row) => row.day === "2026-01-04")
      .map((row) => row.status),
    ["unavailable", "match"],
  );
  const logged = context.mock.method(console, "error", () => {});
  state.database.pragma("query_only = ON");
  state.enqueue(1);
  await state.called(3);
  state.calls[2]?.resolve("feed");
  await until(() => logged.mock.callCount() === 1);
  assert.deepEqual(logged.mock.calls[0]?.arguments, [
    "calendar_refresh_failed",
  ]);
});

test("shutdown aborts fetches, drops queued work and awaits evaluation before closing the evaluator", async (context) => {
  const state = setup(context);
  let release: ((result: CalendarResult) => void) | undefined;
  state.evaluate(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  state.people.forEach((_person, owner) => state.enqueue(owner));
  await state.called(2);
  state.calls[0]?.resolve("feed");
  await until(() => release !== undefined);
  const stopping = state.calendar.stop();
  assert.equal(state.calls[1]?.signal.aborted, true);
  assert.equal(state.closed(), false);
  assert.equal(state.calls.length, 2);
  release?.({ status: "match", rule_index: 0 });
  await stopping;
  assert.equal(state.closed(), true);
  assert.equal(state.enqueue(), "stopped");
  assert.deepEqual(state.rows(), []);
});

test("migrated owned rule and cache FKs reject foreign and missing types and map deletion to day_type_in_use", async (context) => {
  const state = setup(context),
    key = { user_id: state.people[0] as number };
  deleteCalendarRules(state.database, key);
  for (const day_type_id of [state.types[1] as number, 99999]) {
    assert.throws(
      () =>
        insertCalendarRule(state.database, {
          ...key,
          position: 0,
          keyword: "office",
          day_type_id,
        }),
      { code: "SQLITE_CONSTRAINT_FOREIGNKEY" },
    );
    assert.throws(
      () =>
        commitCalendarCache(state.database, {
          ...state.cache("2026-01-01"),
          status: "match",
          day_type_id,
        }),
      { code: "SQLITE_CONSTRAINT_FOREIGNKEY" },
    );
  }
  const headers = { ...requestedWith, Cookie: cookie(await state.signIn()) };
  for (const reference of ["rule", "cache"]) {
    if (reference === "rule")
      insertCalendarRule(state.database, {
        ...key,
        position: 0,
        keyword: "office",
        day_type_id: state.types[0] as number,
      });
    else {
      deleteCalendarRules(state.database, key);
      commitCalendarCache(state.database, {
        ...state.cache("2026-01-01"),
        status: "match",
        day_type_id: state.types[0] as number,
      });
    }
    const response = await state.app.request("/api/plan/day-types", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "delete", id: state.types[0] }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: { code: "day_type_in_use" },
    });
  }
});
