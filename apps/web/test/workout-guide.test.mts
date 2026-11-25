import assert from "node:assert/strict";
import { test } from "node:test";
import {
  finishGuide,
  markSet,
  newGuideDraft,
  opensShort,
  prescribedSet,
  restSeconds,
  type ScheduledWorkout,
} from "../src/workout-guide.ts";

const card = {
  equipment: "Bench",
  rest_seconds: 45,
  sessions: 0,
  setup: [],
  cues: [],
  mistakes: [],
  safety: [],
  pictures: [],
};
const planned = { name: "Step up", sets: 2, reps: "8", load: "20 lb", card };

test("a movement with 3 or more sessions opens the short card", () => {
  for (const [sessions, expected] of [
    [2, false],
    [3, true],
    [4, true],
  ] as const)
    assert.equal(
      opensShort({ ...planned, card: { ...card, sessions } }),
      expected,
      String(sessions),
    );
  assert.equal(opensShort({ ...planned, card: null }), false);
});

test("marking a set starts prescribed rest on a stepped clock", () => {
  let now = 1000;
  const clock = () => now;
  for (const [entryCard, seconds] of [
    [card, 45],
    [null, 90],
    [{ ...card, rest_seconds: null }, 90],
  ] as const) {
    const movement = { ...planned, card: entryCard };
    const draft = markSet(
      newGuideDraft(),
      "00:00",
      prescribedSet(movement),
      movement,
      clock,
    );
    assert.equal(restSeconds(draft.rest.end, clock), seconds);
    now += (seconds + 1) * 1000;
    assert.equal(restSeconds(draft.rest.end, clock), 0);
  }
});

test("Finish posts marked sets as one session and reuses the client id", async () => {
  const workout: ScheduledWorkout = {
    day: "2026-01-05",
    kind: "lift",
    name: "Upper A",
    session: "upper-a",
    movements: [planned],
  };
  const row = prescribedSet(planned);
  const second = markSet(newGuideDraft(), "00:01", row, planned, () => 0);
  const draft = markSet(
    second,
    "00:00",
    { ...row, reps: "6" },
    planned,
    () => 1,
  );
  const calls: unknown[] = [];
  const post = async (body: unknown) => {
    calls.push(body);
    return { id: 1 };
  };
  await finishGuide(workout, draft, post);
  assert.deepEqual(calls, [
    {
      timing: "date_only",
      day: workout.day,
      kind: "lift",
      notes: "Upper A",
      client_id: draft.clientId,
      sets: [6, 8].map((reps) => ({
        exercise: "Step up",
        reps,
        load: 20,
        load_unit: "lb",
      })),
    },
  ]);
  await finishGuide(workout, draft, post);
  assert.deepEqual(calls[1], calls[0]);
});
