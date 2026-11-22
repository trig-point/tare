import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { mcpSession } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";
import { exampleSchedule } from "./support/workout-schedule.ts";

async function setup(context: TestContext) {
  const users = await twoUsers(context, "fallback");
  const call = async (path: string, body?: unknown) => {
    const response = await users.admin.request(path, {
      method: body === undefined ? "GET" : "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, ...(await response.json()) };
  };
  return {
    ...users,
    call,
    replace: (body: unknown) => call("/api/workout-schedule", body),
    read: () => call("/api/workout-schedule"),
    today: () => call("/api/workout-schedule/today"),
  };
}

test("replace then read returns the same document, and a stale updated is refused", async (context) => {
  const { replace, read, today, database } = await setup(context);
  assert.deepEqual(await read(), { status: 200, schedule: null });
  assert.deepEqual(await today(), { status: 200, today: null });
  const early = { ...exampleSchedule(), updated: "2026-01-01T00:00:00.000Z" };
  assert.equal((await replace(early)).status, 409);
  const first = await replace({
    ...exampleSchedule(),
    updated_by: "example-coach",
  });
  assert.equal(first.status, 200);
  const { updated, ...stored } = first.schedule;
  assert.deepEqual(
    Object.keys(stored.week),
    Object.keys(exampleSchedule().week),
  );
  assert.deepEqual(stored, {
    ...exampleSchedule(),
    updated_by: "example-coach",
  });
  assert.deepEqual(await read(), { status: 200, schedule: first.schedule });
  const second = await replace({
    ...exampleSchedule({ next_session: "push_b" }),
    updated,
  });
  assert.equal(second.status, 200);
  assert.ok(second.schedule.updated > updated);
  for (const stale of [updated, undefined, "2026-01-01T00:00:00.000Z"])
    assert.deepEqual(await replace({ ...exampleSchedule(), updated: stale }), {
      status: 409,
      error: { code: "schedule_conflict" },
    });
  assert.deepEqual(await read(), { status: 200, schedule: second.schedule });
  assert.equal(
    database.prepare("SELECT count(*) FROM workout_schedules").pluck().get(),
    1,
  );
});

test("today picks the dated entry, else the weekday template and its group", async (context) => {
  const { replace, today, read } = await setup(context);
  const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
    [
      "dated entry over the template",
      {
        planned: [
          { date: "2026-01-01", kind: "rest", label: "Example holiday" },
        ],
      },
      {
        source: "planned",
        kind: "rest",
        name: "Example holiday",
        session: null,
      },
    ],
    [
      "template naming a key",
      {},
      { source: "week", kind: "lift", name: "Legs A", session: "legs_a" },
    ],
    [
      "group day takes next_session",
      {
        week: {
          ...exampleSchedule().week,
          thu: { kind: "lift", session: "push" },
        },
        next_session: "push_b",
      },
      { source: "week", name: "Push B", session: "push_b" },
    ],
    [
      "group day falls back to rotation order",
      {
        week: {
          ...exampleSchedule().week,
          thu: { kind: "lift", session: "push" },
        },
        next_session: "legs_a",
        rotation: ["legs_a", "push_b", "push_a"],
      },
      { source: "week", name: "Push B", session: "push_b" },
    ],
  ];
  for (const [name, overrides, expected] of cases) {
    const updated = (await read()).schedule?.updated;
    assert.equal(
      (await replace({ ...exampleSchedule(overrides), updated })).status,
      200,
      name,
    );
    const { today: entry } = await today();
    assert.equal(entry.day, "2026-01-01", name);
    for (const [key, value] of Object.entries(expected))
      assert.deepEqual(entry[key], value, `${name}: ${key}`);
    assert.equal(entry.movements.length, entry.session ? 1 : 0, name);
  }
});

test("a malformed document is refused over HTTP and MCP and nothing is stored", async (context) => {
  const setup = await twoUsers(context, "access");
  const client = await mcpSession(context, setup, setup.admin.user.id);
  const week = exampleSchedule().week;
  const cases: [string, Record<string, unknown>][] = [
    [
      "unknown planned session",
      { planned: [{ date: "2026-01-02", session: "pull_a" }] },
    ],
    ["unknown rotation session", { rotation: ["pull_a"] }],
    ["bad date", { planned: [{ date: "2026-02-30", session: "push_a" }] }],
    [
      "duplicate date",
      {
        planned: [
          { date: "2026-01-02", session: "push_a" },
          { date: "2026-01-02", session: "push_b" },
        ],
      },
    ],
    ["unknown top-level key", { extra: true }],
    [
      "near-miss group",
      { week: { ...week, mon: { kind: "lift", session: "pu" } } },
    ],
    ["missing weekday", { week: { ...week, sun: undefined } }],
    [
      "blank label",
      { week: { ...week, fri: { kind: "rest", label: " \t " } } },
    ],
    ["group outside rotation", { rotation: ["legs_a"], next_session: null }],
    ["Windows zone name", { timezone: "Eastern Standard Time" }],
    ["fixed offset zone", { timezone: "+05:30" }],
  ];
  for (const [name, overrides] of cases) {
    const body = exampleSchedule(overrides);
    const response = await setup.admin.request("/api/workout-schedule", {
      method: "POST",
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400, name);
    const { error } = await response.json();
    assert.equal(error.code, "invalid_request", name);
    const tool = await client.callTool({
      name: "replace_workout_schedule",
      arguments: body,
    });
    assert.equal(tool.isError, true, name);
    const [content] = tool.content as { text: string }[];
    assert.ok(content?.text.includes(error.issues[0]), name);
  }
  const extra = { name: "Example extra", where: "home", note: "x".repeat(200) };
  const sessions: Record<string, unknown> = { ...exampleSchedule().sessions };
  for (let index = 0; JSON.stringify(sessions).length <= 60_000; index++)
    sessions[`extra_${index}`] = { ...extra, movements: [] };
  const large = await setup.admin.request("/api/workout-schedule", {
    method: "POST",
    body: JSON.stringify(exampleSchedule({ sessions })),
  });
  assert.equal(large.status, 413);
  assert.equal((await large.json()).error.code, "schedule_too_large");
  const read = await client.callTool({
    name: "read_workout_schedule",
    arguments: {},
  });
  assert.deepEqual(read.structuredContent, { schedule: null });
  const stored = await client.callTool({
    name: "replace_workout_schedule",
    arguments: exampleSchedule(),
  });
  assert.equal(stored.isError, undefined);
  const today = await client.callTool({ name: "today_workout", arguments: {} });
  assert.equal(
    (today.structuredContent as { today: { name: string } }).today.name,
    "Legs A",
  );
});
