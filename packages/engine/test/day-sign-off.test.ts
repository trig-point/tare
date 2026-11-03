import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { operations } from "../src/operations/index.ts";
import { executeOperation } from "../src/operations/registry.ts";
import { insertAgentToken } from "../src/queries/insert-agent-token.ts";
import {
  accessConfig,
  assertionHeader,
  dummyHash,
  signAccessToken,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

type Person = Awaited<ReturnType<typeof twoUsers>>["admin"];
async function send(
  person: Person,
  path: string,
  body?: unknown,
  method = "POST",
) {
  const response = await person.request(
    path,
    body === undefined
      ? {}
      : {
          method,
          body: JSON.stringify(body),
        },
  );
  assert.ok(response.ok, `${path}: ${response.status}`);
  return response.json();
}
const day = "2025-12-30";
const otherDay = "2025-12-31";
const sign = (person: Person, date = day) =>
  send(person, "/api/days/sign-off", { day: date });
const read = (person: Person, date = day) => send(person, `/api/days/${date}`);
const log = (person: Person, client_id: string, date = day) =>
  send(person, "/api/intake", {
    client_id,
    name: "Example soup",
    kcal: 0.1,
    eaten_at: `${date}T12:00:00.000Z`,
  });

test("browser sign-off preserves, clears and replaces fields; reads and lists belong to the caller", async (context) => {
  const setup = await twoUsers(context, "fallback");
  const { admin, member } = setup;
  const initial = await send(admin, "/api/days/sign-off", {
    day,
    hunger: 1,
    fullness: 5,
    notes: "First",
  });
  assert.deepEqual(initial, {
    day,
    signed_off_at: "2026-01-01T00:00:00.000Z",
    hunger: 1,
    fullness: 5,
    notes: "First",
  });
  for (const [input, expected] of [
    [{ day }, [1, 5, "First"]],
    [{ day, hunger: null, fullness: null, notes: null }, [null, null, null]],
    [
      { day, hunger: 3, fullness: 4, notes: "Replacement" },
      [3, 4, "Replacement"],
    ],
  ] as const) {
    const result = await send(admin, "/api/days/sign-off", input);
    assert.deepEqual([result.hunger, result.fullness, result.notes], expected);
  }
  for (const note of ["Second", "Third"])
    await send(admin, "/api/days/note", { day, note });
  assert.equal((await read(admin)).notes, "Replacement\nSecond\nThird");
  assert.equal((await read(admin)).signed_off_at, initial.signed_off_at);
  assert.equal(
    (await send(admin, "/api/days/sign-off", { day, notes: "Final" })).notes,
    "Final",
  );
  assert.deepEqual((await read(member)).entries, []);
  assert.equal((await read(member)).notes, null);
  await send(member, "/api/days/note", { day, note: "Member only" });
  await sign(member);
  assert.equal((await read(admin)).notes, "Final");
  await send(admin, "/api/days/note", { day: otherDay, note: "Review" });
  await send(admin, "/api/days/note", { day: "2026-01-01", note: "Today" });
  await send(member, "/api/days/note", { day: "2025-12-29", note: "Private" });
  assert.deepEqual(
    (await send(admin, "/api/days/unsigned")).days.map(
      (row: { day: string }) => row.day,
    ),
    [otherDay],
  );
  const future = "2026-01-02";
  const empty = await read(admin, future);
  assert.deepEqual(
    [
      empty.day,
      empty.signed_off_at,
      empty.hunger,
      empty.fullness,
      empty.notes,
      empty.entries,
    ],
    [future, null, null, null, null, []],
  );
  for (const total of Object.values(empty.totals))
    assert.deepEqual(total, { total: 0, complete: true, known_subtotal: 0 });
  const logged = await log(admin, "future", future);
  const second = await send(admin, "/api/intake", {
    client_id: "fractional",
    name: "Example broth",
    kcal: 0.2,
    eaten_at: `${future}T13:00:00.000Z`,
  });
  const populated = await read(admin, future);
  assert.deepEqual(populated.entries, [logged.entry, second.entry]);
  assert.deepEqual(populated.totals.kcal, {
    total: 0.30000000000000004,
    complete: true,
    known_subtotal: 0.30000000000000004,
  });
  assert.deepEqual((await read(admin, "2025-12-28")).entries, []);
  const deps = {
    database: setup.database,
    config: loadConfig({
      DATABASE_URL: ":memory:",
    }),
    clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
    dummyHash,
    verifyPassword: async () => false,
    signInLimiter: { waiting: 0 },
  };
  for (const name of ["sign_off_day", "add_day_note", "read_day"]) {
    const operation = operations.find((item) => item.name === name);
    assert.ok(operation);
    for (const invalid of ["2026-02-30", "unsigned", ""])
      await assert.rejects(
        executeOperation(
          operation,
          {
            day: invalid,
            ...(name === "add_day_note" ? { note: "Note" } : {}),
          },
          { credential: "session", person: setup.admin.user },
          deps,
        ),
        { code: "invalid_request", status: 400 },
      );
  }
  for (const [path, input, code] of [
    ["sign-off", {}, "invalid_request"],
    ["sign-off", { day, hunger: 0 }, "invalid_request"],
    ["sign-off", { day, hunger: 6 }, "invalid_request"],
    ["sign-off", { day, fullness: 0 }, "invalid_request"],
    ["sign-off", { day, fullness: 6 }, "invalid_request"],
    ["sign-off", { day, hunger: 1.5 }, "invalid_request"],
    ["note", { day, note: " " }, "invalid_request"],
    ["note", { day, note: "a".repeat(2001) }, "invalid_request"],
    ["note", { day: future, note: "No" }, "day_in_future"],
    ["sign-off", { day: future }, "day_in_future"],
    ["sign-off", { day, user_id: member.user.id }, "invalid_request"],
  ] as const) {
    const response = await admin.request(`/api/days/${path}`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: { code } });
  }
  const malformedRead = await admin.request("/api/days/2026-02-30");
  assert.equal(malformedRead.status, 400);
  assert.deepEqual(await malformedRead.json(), {
    error: { code: "invalid_request" },
  });
  const dates = Array.from({ length: 91 }, (_, index) =>
    new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
  ).reverse();
  const insert = setup.database.prepare(
    "INSERT INTO days (user_id, day) VALUES (?, ?)",
  );
  for (const date of dates) insert.run(admin.user.id, date);
  assert.deepEqual(
    (await send(admin, "/api/days/unsigned")).days.map(
      (row: { day: string }) => row.day,
    ),
    [otherDay, ...dates].slice(0, 90),
  );
  setup.setNow("2026-01-01T22:30:00.000Z");
  assert.equal(
    (await sign(admin, future)).signed_off_at,
    "2026-01-01T22:30:00.000Z",
  );
});

for (const mutation of ["create", "edit", "delete", "move", "replay"] as const)
  test(`intake ${mutation} resets exactly the touched days and preserves other people`, async (context) => {
    const { admin, member } = await twoUsers(context, "fallback");
    const { entry } = await log(admin, "first");
    for (const person of [admin, member])
      for (const date of [day, otherDay]) await sign(person, date);
    if (mutation === "create") await log(admin, "second");
    if (mutation === "edit")
      await send(admin, `/api/intake/${entry.id}`, { kcal: 0.2 }, "PATCH");
    if (mutation === "delete")
      await send(admin, `/api/intake/${entry.id}`, {}, "DELETE");
    if (mutation === "move")
      await send(
        admin,
        `/api/intake/${entry.id}`,
        { eaten_at: `${otherDay}T12:00:00.000Z` },
        "PATCH",
      );
    if (mutation === "replay")
      assert.equal((await log(admin, "first")).created, false);
    for (const person of [admin, member])
      for (const date of [day, otherDay]) {
        const resets =
          person === admin &&
          mutation !== "replay" &&
          (date === day || mutation === "move");
        assert.equal(
          (await read(person, date)).signed_off_at,
          resets ? null : "2026-01-01T00:00:00.000Z",
        );
      }
    if (mutation === "delete")
      assert.deepEqual((await read(admin)).entries, []);
  });

test("service callers cannot sign off; MCP notes preserve sign-off and the tool list excludes it", async (context) => {
  const setup = await twoUsers(context, "access");
  insertAgentToken(setup.database, {
    user_id: setup.admin.user.id,
    client_id: "example-notes",
    name: "Example",
    created_at: "2026-01-01T00:00:00.000Z",
  });
  const headers = {
    ...assertionHeader(
      await signAccessToken({ sub: "", common_name: "example-notes" }),
    ),
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  const forbidden = await setup.app.request("/api/days/sign-off", {
    method: "POST",
    headers,
    body: JSON.stringify({ day }),
  });
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), { error: { code: "forbidden" } });
  const operation = operations.find((item) => item.name === "sign_off_day");
  assert.ok(operation);
  await assert.rejects(
    executeOperation(
      operation,
      { day },
      { credential: "service", person: setup.admin.user },
      {
        database: setup.database,
        config: accessConfig,
        clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
        dummyHash,
        verifyPassword: async () => false,
        signInLimiter: { waiting: 0 },
      },
    ),
    { status: 403, code: "forbidden" },
  );
  const signed = await send(setup.admin, "/api/days/sign-off", {
    day,
    notes: "Browser",
  });
  let session: string | null = null;
  const rpc = async (method: string, params: unknown) => {
    const response = await setup.app.request("/mcp", {
      method: "POST",
      headers: {
        ...headers,
        ...(session ? { "mcp-session-id": session } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    session = response.headers.get("mcp-session-id") ?? session;
    assert.equal(response.status, 200);
    return JSON.parse((await response.text()).split("data: ").at(-1) ?? "")
      .result;
  };
  await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "Example", version: "1" },
  });
  assert.equal(
    (await rpc("tools/list", {})).tools.some(
      (tool: { name: string }) => tool.name === "sign_off_day",
    ),
    false,
  );
  const result = await rpc("tools/call", {
    name: "add_day_note",
    arguments: { day, note: "Agent" },
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, {
    ...signed,
    notes: "Browser\nAgent",
  });
});
