import assert from "node:assert/strict";
import { assertionHeader, signAccessToken } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

for (const mode of ["fallback", "access"] as const)
  test(`signals validate units, replace values and isolate owners in ${mode}`, async (context) => {
    const { admin, member } = await twoUsers(context, mode);
    const send = async (path: string, body?: unknown, other = false) => {
      const response = await (other ? member : admin).request(path, {
        method: body === undefined ? "GET" : "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    const today = await send("/api/today");
    const day = today.body.day;
    const path = `/api/signals/${day}`;
    assert.deepEqual((await send(path)).body, {
      day,
      signals: [],
      activities: [],
    });
    for (const [metric, value, unit] of [
      ["steps", 3000, "count"],
      ["active_calories", 220.5, "kcal"],
      ["sleep", 430, "minutes"],
      ["resting_heart_rate", 58, "bpm"],
      ["hrv", 42.5, "ms"],
      ["readiness", 80, "score"],
      ["stress", 25, "score"],
    ] as const) {
      const logged = await send("/api/signals", { metric, value });
      assert.equal(logged.status, 200);
      assert.deepEqual([logged.body.day, logged.body.unit], [day, unit]);
      assert.deepEqual(
        (await send(path)).body.signals.find(
          (row: { metric: string }) => row.metric === metric,
        ),
        { metric, value, unit, source: "manual" },
      );
    }
    for (const body of [
      {},
      { metric: "unknown", value: 1 },
      { metric: "steps", value: 1.5 },
      { metric: "steps", value: -1 },
      { metric: "readiness", value: 101 },
      { metric: "sleep", value: 1441 },
      { metric: "hrv", value: 0 },
      { metric: "stress", value: "high" },
      { metric: "sleep", value: 1, day: "2026-02-30" },
      { metric: "steps", value: 1, user_id: member.user.id },
      { metric: "steps", value: 1, source: "agent" },
    ])
      assert.deepEqual(await send("/api/signals", body), {
        status: 400,
        body: { error: { code: "invalid_request" } },
      });
    assert.deepEqual(
      await send("/api/signals", {
        metric: "steps",
        value: 1,
        day: "2099-01-01",
      }),
      { status: 400, body: { error: { code: "day_in_future" } } },
    );
    await send("/api/signals", { metric: "steps", value: 3200, day });
    assert.deepEqual(
      (await send(path)).body.signals.map(
        (row: { metric: string }) => row.metric,
      ),
      [
        "active_calories",
        "hrv",
        "readiness",
        "resting_heart_rate",
        "sleep",
        "steps",
        "stress",
      ],
    );
    assert.deepEqual((await send(path, undefined, true)).body, {
      day,
      signals: [],
      activities: [],
    });
    const own = await send(
      "/api/signals",
      { metric: "steps", value: 12, day },
      true,
    );
    assert.equal(own.body.user_id, member.user.id);
    assert.equal(
      (await send(path)).body.signals.find(
        (row: { metric: string }) => row.metric === "steps",
      ).value,
      3200,
    );
    assert.deepEqual(await send("/api/today"), today);
    const activity = {
      started_at: "2026-01-01T03:59:00+05:30",
      duration_minutes: 25,
      kind: "walk",
      client_id: "same",
    };
    const first = await send("/api/activities", activity);
    assert.deepEqual(
      [first.status, first.body.day, first.body.source, first.body.calories],
      [200, "2025-12-31", "manual", null],
    );
    assert.deepEqual(
      await send("/api/activities", { ...activity, duration_minutes: 90 }),
      first,
    );
    const foreign = await send("/api/activities", activity, true);
    assert.notEqual(foreign.body.id, first.body.id);
    assert.equal(foreign.body.user_id, member.user.id);
    for (const body of [
      {},
      { ...activity, kind: " " },
      { ...activity, duration_minutes: 0 },
      { ...activity, duration_minutes: 1.5 },
      { ...activity, calories: -1 },
    ])
      assert.equal((await send("/api/activities", body)).status, 400);
    assert.deepEqual(
      await send("/api/activities", {
        ...activity,
        client_id: "bad",
        started_at: "2026-02-30T00:00:00Z",
      }),
      { status: 400, body: { error: { code: "invalid_time" } } },
    );
    assert.equal((await send("/api/signals/invalid")).status, 400);
  });

test("MCP keeps different sources and records agent activity on its local day", async (context) => {
  const { app, admin, member } = await twoUsers(context, "access");
  const mapping = await admin.request("/api/agent-tokens", {
    method: "POST",
    body: JSON.stringify({
      client_id: "example-signals-agent",
      user_id: admin.user.id,
      name: "Example agent",
    }),
  });
  assert.equal(mapping.status, 201);
  const headers = {
    ...assertionHeader(
      await signAccessToken({ sub: "", common_name: "example-signals-agent" }),
    ),
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  const rpc = async (method: string, params: unknown) => {
    const response = await app.request("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    assert.equal(response.status, 200);
    const session = response.headers.get("mcp-session-id");
    if (session) Object.assign(headers, { "mcp-session-id": session });
    return JSON.parse((await response.text()).split("data: ").at(-1) ?? "")
      .result;
  };
  await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "example", version: "1.0.0" },
  });
  const call = async (name: string, args: unknown) => {
    const result = await rpc("tools/call", { name, arguments: args });
    assert.notEqual(result.isError, true);
    return result.structuredContent;
  };
  await admin.request("/api/signals", {
    method: "POST",
    body: JSON.stringify({ metric: "steps", value: 12 }),
  });
  await call("log_signal", { metric: "steps", value: 45 });
  const signals = await call("read_signals", { day: "2026-01-01" });
  assert.deepEqual(signals.signals, [
    { metric: "steps", unit: "count", value: 45, source: "agent" },
    { metric: "steps", unit: "count", value: 12, source: "manual" },
  ]);
  const activity = {
    started_at: "2026-01-01T03:59:00+05:30",
    duration_minutes: 25,
    kind: "walk",
    calories: 120,
  };
  const first = await call("log_activity", activity);
  assert.equal(first.day, "2025-12-31");
  const second = await call("log_activity", {
    ...activity,
    started_at: "2026-01-01T04:00:00+05:30",
  });
  assert.equal(second.day, "2026-01-01");
  const read = await call("read_signals", { day: first.day });
  assert.deepEqual(read.activities, [
    {
      id: first.id,
      ...activity,
      started_at: "2025-12-31T22:29:00.000Z",
      source: "agent",
    },
  ]);
  assert.deepEqual(
    await (await member.request(`/api/signals/${first.day}`)).json(),
    { day: first.day, signals: [], activities: [] },
  );
});
