import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";
import { exampleSchedule } from "./support/workout-schedule.ts";

async function setup(context: TestContext) {
  const users = await twoUsers(context, "fallback");
  return async (method: string, path: string, body?: unknown) => {
    const response = await users.admin.request(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, ...(await response.json()) };
  };
}

const press = {
  name: "Example press",
  setup: ["Set the bench flat", "Grip just outside shoulders"],
  cues: ["Drive feet into the floor"],
  mistakes: ["Flaring elbows"],
  safety: ["Keep the neck neutral"],
  pictures: ["https://images.example.com/press.png"],
  rest_seconds: 90,
  source: "example-db/press",
  equipment: "Bench and dumbbells",
};

test("save, get, list and remove a movement card by name", async (context) => {
  const call = await setup(context);
  assert.deepEqual(await call("GET", "/api/movements"), {
    status: 200,
    movements: [],
  });
  const saved = await call("POST", "/api/movements", press);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.movement, {
    id: saved.movement.id,
    ...press,
    sessions: 0,
  });
  const renamed = await call("POST", "/api/movements", {
    name: "  example PRESS ",
  });
  assert.deepEqual(renamed.movement, {
    id: saved.movement.id,
    name: "example PRESS",
    setup: [],
    cues: [],
    mistakes: [],
    safety: [],
    pictures: [],
    rest_seconds: null,
    source: null,
    equipment: null,
    sessions: 0,
  });
  assert.deepEqual(
    await call("GET", `/api/movements/${encodeURIComponent("Example Press")}`),
    { status: 200, movement: renamed.movement },
  );
  const malformed: [string, Record<string, unknown>][] = [
    ["blank name", { name: " \t " }],
    ["missing name", { cues: ["Brace"] }],
    ["NUL in a cue", { name: "Example row", cues: ["Bra\u0000ce"] }],
    [
      "non-http picture",
      { name: "Example row", pictures: ["ftp://x.example/a"] },
    ],
    ["fractional rest", { name: "Example row", rest_seconds: 1.5 }],
  ];
  for (const [label, body] of malformed)
    assert.equal(
      (await call("POST", "/api/movements", body)).status,
      400,
      label,
    );
  assert.equal((await call("GET", "/api/movements")).movements.length, 1);
  assert.deepEqual(await call("DELETE", "/api/movements/EXAMPLE%20press"), {
    status: 200,
    deleted: true,
    id: saved.movement.id,
  });
  for (const method of ["GET", "DELETE"])
    assert.deepEqual(await call(method, "/api/movements/Example%20press"), {
      status: 404,
      error: { code: "not_found" },
    });
});

test("today gives a scheduled movement with a library match its card, and one without none", async (context) => {
  const call = await setup(context);
  const legs = exampleSchedule().sessions.legs_a;
  const unknown = { name: "Example unknown lift", sets: 2, reps: "10" };
  await call(
    "POST",
    "/api/workout-schedule",
    exampleSchedule({
      sessions: {
        ...exampleSchedule().sessions,
        legs_a: { ...legs, movements: [...legs.movements, unknown] },
      },
    }),
  );
  const { movement } = await call("POST", "/api/movements", {
    ...press,
    name: "EXAMPLE PRESS",
  });
  const { today } = await call("GET", "/api/workout-schedule/today");
  assert.deepEqual(today.movements, [
    { ...legs.movements[0], card: movement },
    { ...unknown, card: null },
  ]);
});

test("the session count counts sessions, not sets", async (context) => {
  const call = await setup(context);
  await call("POST", "/api/movements", { name: "Example press" });
  const sessions = async () =>
    (await call("GET", "/api/movements/Example%20press")).movement.sessions;
  const session = (sets: string[], started_at: string) =>
    call("POST", "/api/activities", {
      started_at,
      duration_minutes: 40,
      kind: "strength",
      sets: sets.map((exercise) => ({ exercise, reps: 8 })),
    });
  await session(["Example squat"], "2026-01-01T08:00:00Z");
  assert.equal(await sessions(), 0);
  await session(
    ["Example press", "example press", "Example PRESS", "Example squat"],
    "2026-01-01T09:00:00Z",
  );
  assert.equal(await sessions(), 1);
  await session(["Example press"], "2026-01-01T10:00:00Z");
  assert.equal(await sessions(), 2);
  assert.equal((await call("GET", "/api/movements")).movements[0].sessions, 2);
});
