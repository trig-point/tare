import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../src/api.ts";
import { setInput } from "../src/health-api.ts";
import {
  closeStaleGuide,
  newGuideSet,
  opensShort,
  prescribedSet,
  restEnd,
  restSeconds,
  type ScheduledWorkout,
  saveGuideSet,
  undoGuideSet,
} from "../src/workout-guide.ts";

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
  movements: [movement],
};
const clientId = "guide:2026-01-05:upper_a";
const activity = { id: 3, client_id: clientId, sets: [] };
const input = setInput(prescribedSet(movement));

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
