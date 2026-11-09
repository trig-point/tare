import assert from "node:assert/strict";
import { mock } from "node:test";
import type { SelectActivitiesResult } from "../src/queries/select-activities.ts";
import { upsertSourceActivity } from "../src/queries/upsert-source-activity.ts";
import { setCap, widestSession, widestSet } from "../src/signals/activities.ts";
import { countUnknownKinds } from "../src/signals/activity-kinds.ts";
import { mergeWorkouts } from "../src/signals/merged-workouts.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const day = "2026-03-02";
const at = (time: string) => `${day}T${time}:00.000Z`;
const strengthSet = {
  exercise: "Goblet squat",
  reps: 8,
  load: 50,
  load_unit: "lb",
  rir_low: 3,
  rir_high: 4,
};

test("sets, timing, cap, replay, replacement and owner isolation over HTTP", async (context) => {
  const { admin, member, database } = await twoUsers(context, "fallback");
  const send = async (path: string, body?: unknown, method = "POST") => {
    const response = await admin.request(path, {
      method: body === undefined ? "GET" : method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const rows = (table: string) =>
    database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  const timed = {
    started_at: at("18:00"),
    duration_minutes: 60,
    kind: "strength",
    client_id: "example-strength",
    sets: [{ ...strengthSet, set_type: "warmup" }, strengthSet, strengthSet],
  };
  const logged = await send("/api/activities", timed);
  assert.equal(logged.status, 200);
  assert.deepEqual(
    logged.body.sets.map((set: Record<string, unknown>) =>
      Object.values(set).join(" "),
    ),
    ["warmup", "working", "working"].map(
      (type, index) => `${index + 1} Goblet squat ${type} 8 50 lb 22.68  3 4 `,
    ),
  );
  const before = [rows("activity_sessions"), rows("activity_sets")];
  assert.deepEqual(
    await send("/api/activities", { ...timed, sets: [], kind: "walk" }),
    logged,
  );
  assert.deepEqual([rows("activity_sessions"), rows("activity_sets")], before);
  const dateOnly = await send("/api/activities", {
    timing: "date_only",
    day: logged.body.day,
    kind: "strength",
    sets: [strengthSet, strengthSet],
  });
  assert.deepEqual(
    [dateOnly.body.started_at, dateOnly.body.duration_minutes],
    [null, null],
  );
  const range = `/api/activities/${logged.body.day}/${logged.body.day}`;
  assert.deepEqual(
    (await send(range)).body.workouts.map(
      (workout: { id: number }) => workout.id,
    ),
    [logged.body.id, dateOnly.body.id],
  );
  for (const invalid of [
    { timing: "date_only", day, kind: "sauna", started_at: at("07:00") },
    { started_at: at("07:00"), kind: "sauna" },
    {
      ...timed,
      client_id: "rir",
      sets: [{ ...strengthSet, rir_low: 4, rir_high: 3 }],
    },
  ])
    assert.equal((await send("/api/activities", invalid)).status, 400);
  assert.deepEqual(rows("activity_sessions").length, 2);
  const sets = `/api/activities/${logged.body.id}/sets`;
  const replacement = { sets: [{ exercise: "Row", reps: 10 }] };
  const replaced = await send(sets, replacement, "PATCH");
  assert.deepEqual(await send(sets, replacement, "PATCH"), replaced);
  assert.deepEqual(
    replaced.body.sets.map((set: { exercise: string }) => set.exercise),
    ["Row"],
  );
  const stored = rows("activity_sets");
  for (const body of [replacement, { sets: [] }]) {
    const foreign = await member.request(sets, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    assert.equal(foreign.status, 404);
  }
  assert.deepEqual((await (await member.request(range)).json()).workouts, []);
  assert.deepEqual(rows("activity_sets"), stored);
  assert.deepEqual((await send(sets, { sets: [] }, "PATCH")).body.sets, []);
  assert.equal(rows("activity_sets").length, 2);

  upsertSourceActivity(database, {
    user_id: admin.user.id,
    source: "oura",
    source_record_id: "example-workout",
    day: logged.body.day,
    started_at: at("18:05"),
    duration_minutes: 50,
    kind: "strengthTraining",
    calories: 310,
    created_at: at("20:00"),
  });
  const largest = { ...widestSession, sets: Array(setCap).fill(widestSet) };
  assert.ok(Buffer.byteLength(JSON.stringify(largest)) <= 60_000);
  assert.equal(
    (await send("/api/activities", largest)).body.sets.length,
    setCap,
  );
  assert.deepEqual(
    await send("/api/activities", {
      ...timed,
      client_id: "over",
      sets: Array(setCap + 1).fill({ exercise: "Plank" }),
    }),
    { status: 400, body: { error: { code: "too_many_sets" } } },
  );
  const signals = await send(`/api/signals/${logged.body.day}`);
  assert.deepEqual(
    signals.body.activities.map(
      (workout: { id: number; calories: number; tracker: unknown }) => [
        workout.id,
        workout.calories,
        workout.tracker,
      ],
    ),
    [
      [logged.body.id, 310, { id: 3, source: "oura" }],
      [dateOnly.body.id, null, null],
    ],
  );
});

const session = (
  id: number,
  source: string,
  kind: string,
  start: string | null,
  minutes: number | null,
): SelectActivitiesResult => ({
  id,
  timing: start === null ? "date_only" : "exact",
  started_at: start === null ? null : at(start),
  day,
  duration_minutes: minutes,
  kind,
  calories: source === "oura" ? 100 + id : null,
  notes: null,
  source,
});
const pairs = (sessions: SelectActivitiesResult[]) =>
  mergeWorkouts(sessions, [])
    .map((workout) => `${workout.id}:${workout.tracker?.id ?? "-"}`)
    .join(" ");

test("merged workouts pair one-to-one by largest overlap, then earlier start, then lower id", () => {
  const cases: [SelectActivitiesResult[], string][] = [
    [
      [
        session(1, "manual", "strength", "18:00", 60),
        session(2, "oura", "strengthTraining", "17:40", 30),
        session(3, "oura", "weightlifting", "18:10", 40),
      ],
      "1:3 2:-",
    ],
    [
      [
        session(1, "agent", "run", "07:00", 60),
        session(3, "oura", "running", "07:30", 30),
        session(4, "oura", "running", "07:30", 30),
        session(5, "oura", "running", "06:30", 60),
      ],
      "1:5 3:- 4:-",
    ],
    [
      [
        session(1, "manual", "run", "07:00", 30),
        session(3, "oura", "running", "07:00", 30),
        session(2, "oura", "running", "07:00", 30),
      ],
      "1:2 3:-",
    ],
    [
      [
        session(1, "manual", "sauna", "19:00", 20),
        session(2, "oura", "walking", "19:00", 20),
        session(3, "manual", "strength", null, null),
        session(4, "oura", "strengthTraining", "08:00", 45),
        session(5, "manual", "paddleboarding", "10:00", 30),
        session(6, "oura", "paddleboarding", "10:00", 30),
      ],
      "1:- 2:- 3:- 4:- 5:- 6:-",
    ],
  ];
  for (const [sessions, expected] of cases)
    assert.equal(pairs(sessions), expected);
  assert.equal(
    mergeWorkouts([session(6, "oura", "paddleboarding", "10:00", 30)], [])[0]
      ?.category,
    "other",
  );
  const logged = { ...session(1, "agent", "run", "07:00", 30), calories: 250 };
  const tracker = {
    ...session(2, "oura", "running", "07:00", 30),
    calories: null,
  };
  assert.equal(mergeWorkouts([logged, tracker], [])[0]?.calories, 250);
});

test("unknown activity names are counted, never named", () => {
  const info = mock.method(console, "info", () => {});
  countUnknownKinds(["strengthTraining", "paddleboarding", "kiteSurf"], "oura");
  countUnknownKinds(["walking"], "oura");
  assert.deepEqual(
    info.mock.calls.map((call) => call.arguments),
    [["activity_kind_unknown", "oura", 2]],
  );
  info.mock.restore();
});
