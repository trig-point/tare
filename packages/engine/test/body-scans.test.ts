import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { insertWeight } from "../src/queries/insert-weight.ts";
import { mcpSession } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const minimalScan = {
  day: "2026-03-02",
  method: "dexa",
  total_mass_kg: 64.2,
  body_fat_pct: 31.4,
  fat_mass_kg: 20.2,
  lean_mass_kg: 41.6,
  bone_mineral_kg: 2.4,
};
const regionalNulls = Object.fromEntries(
  ["arms", "legs", "trunk", "android", "gynoid"].flatMap((region) => [
    [`${region}_fat_pct`, null],
    [`${region}_lean_kg`, null],
  ]),
);
const fullScan = {
  ...minimalScan,
  day: "2026-01-05",
  arms_fat_pct: 33.1,
  arms_lean_kg: 4.9,
  legs_fat_pct: 35.2,
  legs_lean_kg: 14.3,
  trunk_fat_pct: 29.8,
  trunk_lean_kg: 19.1,
  android_fat_pct: 32.5,
  android_lean_kg: 2.9,
  gynoid_fat_pct: 38.7,
  gynoid_lean_kg: 6.2,
  bone_density_g_cm2: 1.12,
  t_score: -0.4,
  note: "Invented clinic, fasted",
};

async function setup(
  context: TestContext,
  mode: "access" | "fallback" = "fallback",
) {
  const users = await twoUsers(context, mode);
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await users.admin.request(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, ...(await response.json()) };
  };
  return { ...users, call };
}

test("a full and a minimal scan save and read back; a second scan that day is refused", async (context) => {
  const { call } = await setup(context);
  assert.deepEqual(await call("GET", "/api/body-scans"), {
    status: 200,
    scans: [],
  });
  const full = await call("POST", "/api/body-scans", fullScan);
  assert.equal(full.status, 201);
  assert.deepEqual(full.scan, { id: full.scan.id, ...fullScan });
  const minimal = await call("POST", "/api/body-scans", minimalScan);
  assert.equal(minimal.status, 201);
  const minimalRow = {
    id: minimal.scan.id,
    ...minimalScan,
    ...regionalNulls,
    bone_density_g_cm2: null,
    t_score: null,
    note: null,
  };
  assert.deepEqual(minimal.scan, minimalRow);
  assert.deepEqual(
    await call("POST", "/api/body-scans", { ...minimalScan, note: "again" }),
    { status: 409, error: { code: "scan_exists" } },
  );
  assert.deepEqual(await call("GET", "/api/body-scans"), {
    status: 200,
    scans: [full.scan, minimalRow],
  });
  assert.deepEqual(await call("DELETE", `/api/body-scans/${full.scan.id}`), {
    status: 200,
    deleted: true,
    id: full.scan.id,
  });
  assert.equal(
    (await call("DELETE", `/api/body-scans/${full.scan.id}`)).status,
    404,
  );
  assert.deepEqual((await call("GET", "/api/body-scans")).scans, [minimalRow]);
});

test("malformed scans are refused the same way over HTTP and MCP", async (context) => {
  const users = await setup(context, "access");
  const client = await mcpSession(context, users, users.admin.user.id);
  const cases: [string, Record<string, unknown>][] = [
    ["body fat over 100", { body_fat_pct: 100.5 }],
    ["negative body fat", { body_fat_pct: -1 }],
    ["negative fat mass", { fat_mass_kg: -0.1 }],
    ["negative regional lean mass", { legs_lean_kg: -2 }],
    ["regional fat over 100", { trunk_fat_pct: 101 }],
    ["zero total mass", { total_mass_kg: 0 }],
    ["missing lean mass", { lean_mass_kg: undefined }],
    ["unknown method", { method: "bioimpedance" }],
    ["impossible day", { day: "2026-02-30" }],
    ["unknown field", { visceral_fat_kg: 0.5 }],
  ];
  for (const [name, overrides] of cases) {
    const body = { ...minimalScan, ...overrides };
    const response = await users.call("POST", "/api/body-scans", body);
    assert.equal(response.status, 400, name);
    assert.equal(response.error.code, "invalid_request", name);
    const tool = await client.callTool({
      name: "save_body_scan",
      arguments: body,
    });
    assert.equal(tool.isError, true, name);
    const [content] = tool.content as { text: string }[];
    assert.ok(content?.text.includes(response.error.issues[0]), name);
  }
  assert.deepEqual((await users.call("GET", "/api/body-scans")).scans, []);
});

test("body fat history shows each scan with the gap to that day's first scale reading", async (context) => {
  const { call, database, admin } = await setup(context);
  for (const [index, [measured_at, body_fat_pct]] of (
    [
      ["2026-01-05T08:00:00.000Z", 33.2],
      ["2026-01-05T19:00:00.000Z", 30.0],
      ["2026-01-06T08:00:00.000Z", 32.9],
    ] as const
  ).entries())
    insertWeight(database, {
      user_id: admin.user.id,
      client_id: `invented-weigh-in-${index}`,
      measured_at,
      day: measured_at.slice(0, 10),
      created_at: measured_at,
      weight_kg: 64,
      body_fat_pct,
      source: null,
      note: null,
    });
  const scanned = await call("POST", "/api/body-scans", fullScan);
  const unmatched = await call("POST", "/api/body-scans", minimalScan);
  const history = await call("GET", "/api/body-fat/history");
  assert.equal(history.readings.length, 3);
  assert.deepEqual(history.scans, [
    {
      id: scanned.scan.id,
      day: "2026-01-05",
      method: "dexa",
      body_fat_pct: 31.4,
      scale_reading_id: history.readings[0].id,
      scale_body_fat_pct: 33.2,
      gap_points: 1.8,
    },
    {
      id: unmatched.scan.id,
      day: "2026-03-02",
      method: "dexa",
      body_fat_pct: 31.4,
      scale_reading_id: null,
      scale_body_fat_pct: null,
      gap_points: null,
    },
  ]);
});
