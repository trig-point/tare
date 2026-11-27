import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { twoUsers } from "../../../packages/engine/test/support/two-users.ts";
import { exampleSchedule } from "../../../packages/engine/test/support/workout-schedule.ts";
import { ApiError } from "../src/api.ts";
import { setInput, setRow, setText } from "../src/health-api.ts";
import { scheduledWorkoutKey } from "../src/today-api.ts";
import {
  closeStaleGuide,
  guideChoices,
  newGuideSet,
  openGuideChoice,
  opensShort,
  pendingGuideAction,
  prescribedSet,
  readGuideActivity,
  readScheduledWorkout,
  restEnd,
  restSeconds,
  type ScheduledWorkout,
  saveGuideSet,
  undoGuideSet,
} from "../src/workout-guide.ts";
import "./tsx.mts";

const { GuideTile, WorkoutGuideEntry } = await import(
  "../src/workout-guide-screen.tsx"
);

const card = {
  equipment: null,
  rest_seconds: 45,
  sessions: 0,
  setup: [],
  cues: [],
  mistakes: [],
  safety: [],
  pictures: [],
};
const movement = { name: "Step up", sets: 2, reps: "8", card };
const workout: ScheduledWorkout = {
  day: "2026-01-05",
  kind: "lift",
  name: "Upper A",
  session: "upper_a",
  where: "home",
  alternates: [],
  movements: [movement],
};
const clientId = "guide:2026-01-05:upper_a";
const activity = { id: 3, client_id: clientId, sets: [] };
const input = setInput(prescribedSet(movement));

test("the planned load opens as a pin, pound or kilogram set and a pin reads back as a pin", () => {
  for (const [load, expected] of [
    ["pin 10", ["10", "pin"]],
    ["PIN 7.5", ["7.5", "pin"]],
    ["10 pin", ["10", "pin"]],
    ["10 lb", ["10", "lb"]],
    ["10", ["10", "kg"]],
    ["pin", ["", "kg"]],
    ["pin ten", ["", "kg"]],
    [undefined, ["", "kg"]],
  ] as const) {
    const row = prescribedSet({ ...movement, load });
    assert.deepEqual([row.load, row.load_unit], expected, load);
  }
  const pin = setInput(prescribedSet({ ...movement, load: "pin 10" }));
  assert.deepEqual([pin.load, pin.load_unit], [10, "pin"]);
  const stored = {
    ...{ set_index: 1, exercise: "Lat pulldown", set_type: "working" },
    ...{ reps: 10, load: 10, load_unit: "pin", load_kg: null },
    ...{ duration_seconds: null, rir_low: null, rir_high: null, notes: null },
    client_set_id: null,
  };
  assert.equal(setText(stored), "Lat pulldown 10 × pin 10");
  assert.equal(setRow(stored).load_unit, "pin");
  assert.equal(
    setText({ ...stored, load_unit: "lb" }),
    "Lat pulldown 10 × 10 lb",
  );
});

test("Done uses the card rest or 90 seconds and opens short at three sessions", () => {
  for (const [cue, seconds] of [
    [card, 45],
    [null, 90],
  ] as const) {
    const end = restEnd({ ...movement, card: cue }, () => 1000);
    assert.equal(
      restSeconds(end, () => 1000),
      seconds,
    );
    assert.equal(
      restSeconds(end, () => end + 1000),
      0,
    );
  }
  assert.deepEqual(
    [2, 3, 4].map((sessions) =>
      opensShort({ ...movement, card: { ...card, sessions } }),
    ),
    [false, true, true],
  );
});

test("Done mints a fresh ID, retries the same add and uses the server response", async (context) => {
  const first = newGuideSet(input);
  const next = newGuideSet(input);
  assert.notEqual(first.id, next.id);
  assert.match(first.id, /^[a-f0-9-]{36}$/);
  const saved = {
    set_index: 1,
    exercise: movement.name,
    set_type: "working",
    reps: 7,
    load: null,
    load_unit: null,
    load_kg: null,
    duration_seconds: null,
    rir_low: null,
    rir_high: null,
    notes: null,
    client_set_id: first.id,
  };
  const calls: unknown[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (path: string, options: RequestInit) => {
      assert.equal(path, "/api/activity-sets");
      calls.push(JSON.parse(String(options.body)));
      if (calls.length === 1) throw new Error("Response lost");
      return Response.json({ set: saved, sets: [saved], repeat: true });
    },
  );
  await assert.rejects(saveGuideSet(workout, activity, first), /Response lost/);
  assert.deepEqual(await saveGuideSet(workout, activity, first), {
    activity: { ...activity, sets: [saved] },
    saved: true,
  });
  assert.deepEqual(
    calls,
    Array(2).fill({
      session_id: 3,
      session_client_id: clientId,
      client_set_id: first.id,
      set: input,
    }),
  );
});

test("Undo removes by the original identity and stale_session closes the guide", async (context) => {
  context.mock.method(
    globalThis,
    "fetch",
    async (path: string, options: RequestInit) => {
      assert.equal(path, "/api/activity-sets/remove");
      assert.deepEqual(JSON.parse(String(options.body)), {
        session_id: 3,
        session_client_id: clientId,
        client_set_id: "example-set",
      });
      return Response.json(
        { error: { code: "stale_session" } },
        { status: 409 },
      );
    },
  );
  const close = context.mock.fn();
  await assert.rejects(
    undoGuideSet(workout, activity, "example-set"),
    (error) => closeStaleGuide(error, close),
  );
  assert.equal(close.mock.callCount(), 1);
  assert.equal(closeStaleGuide(new ApiError(409, "other"), close), false);
});

test("readback unlocks the guide after a committed Done or Undo loses its response", () => {
  const set = {
    set_index: 1,
    exercise: movement.name,
    set_type: "working",
    reps: 8,
    load: null,
    load_unit: null,
    load_kg: null,
    duration_seconds: null,
    rir_low: null,
    rir_high: null,
    notes: null,
    client_set_id: "saved-set",
  };
  const saved = { ...activity, sets: [set] };
  for (const [action, before, after] of [
    [{ kind: "done", change: { id: "saved-set" } }, activity, saved],
    [{ kind: "undo", id: "saved-set" }, saved, activity],
  ] as const) {
    assert.equal(pendingGuideAction(action, before), action);
    assert.equal(pendingGuideAction(action, after), null);
  }
});

test("the guide offers each version by where and logs the chosen one", async (context) => {
  const { admin } = await twoUsers(context, "fallback");
  context.mock.method(globalThis, "fetch", (path: string, init: RequestInit) =>
    admin.request(path, init),
  );
  const { sessions } = exampleSchedule();
  const body = exampleSchedule({
    sessions: {
      ...sessions,
      legs_a: { ...sessions.legs_a, alternates: ["legs_a_home"] },
      legs_a_home: {
        ...sessions.push_a,
        name: "Legs A home",
        movements: [{ name: "Example squat", sets: 2, reps: "10" }],
      },
    },
  });
  const stored = await admin.request("/api/workout-schedule", {
    method: "POST",
    body: JSON.stringify(body),
  });
  assert.equal(stored.status, 200);
  const scheduled = await readScheduledWorkout();
  assert.ok(scheduled);
  assert.deepEqual(guideChoices({ ...scheduled, alternates: [] }), []);
  const client = new QueryClient();
  client.setQueryData(
    [...scheduledWorkoutKey(admin.user.id), scheduled.day],
    scheduled,
  );
  const entry = createElement(WorkoutGuideEntry, {
    person: admin.user.id,
    day: scheduled.day,
    online: true,
    refresh: async () => {},
  });
  const tile = (markup: string) => [
    /<strong>([^<]*)<\/strong>/.exec(markup)?.[1],
    ...Array.from(
      markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g),
      (match) => match[1],
    ),
  ];
  assert.deepEqual(
    tile(
      renderToStaticMarkup(
        createElement(QueryClientProvider, { client }, entry),
      ),
    ),
    ["Legs A", "example gym", "home"],
  );
  assert.equal(await openGuideChoice(scheduled, "legs_a"), scheduled);
  const chosen = await openGuideChoice(scheduled, "legs_a_home");
  const open = createElement(GuideTile, {
    scheduled,
    active: chosen,
    online: true,
    pending: false,
    failed: false,
    open: () => {},
    choose: () => {},
  });
  assert.deepEqual(tile(renderToStaticMarkup(open)), [
    "Legs A",
    "example gym",
    "home",
  ]);
  const [squat] = chosen.movements;
  assert.ok(squat);
  await saveGuideSet(chosen, null, newGuideSet(setInput(prescribedSet(squat))));
  const saved = await readGuideActivity(chosen);
  const [logged] = (
    await (
      await admin.request(`/api/activities/${chosen.day}/${chosen.day}`)
    ).json()
  ).workouts;
  assert.deepEqual(
    [logged.sets[0]?.exercise, saved?.client_id, logged.notes],
    ["Example squat", `guide:${chosen.day}:legs_a_home`, "Legs A home"],
  );
});
