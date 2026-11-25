import assert from "node:assert/strict";
import { test } from "node:test";
import { type SavedWorkout, setInput } from "../src/health-api.ts";
import {
  guideSlot,
  opensShort,
  prescribedSet,
  restEnd,
  restSeconds,
  type ScheduledWorkout,
  SHORT_CARD_SESSIONS,
  saveGuideSet,
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
const movement = { name: "Step up", sets: 2, reps: "8", load: "20 lb", card };
const workout: ScheduledWorkout = {
  day: "2026-01-05",
  kind: "lift",
  name: "Upper A",
  session: "upper_a",
  movements: [movement],
};
const existing: SavedWorkout = {
  id: 3,
  sets: [
    {
      set_index: 1,
      exercise: "Step up",
      reps: 8,
      load: 20,
      load_unit: "lb",
      load_kg: 9.07,
      set_type: "working",
      notes: guideSlot(0, 0),
      duration_seconds: null,
      rir_low: null,
      rir_high: null,
    },
  ],
};
const row = setInput(prescribedSet(movement));

test("marking Done starts prescribed rest on a stepped clock", () => {
  let now = 1000;
  const clock = () => now;
  for (const [restCard, seconds] of [
    [card, 45],
    [null, 90],
    [{ ...card, rest_seconds: null }, 90],
  ] as const) {
    const end = restEnd({ ...movement, card: restCard }, clock);
    assert.equal(restSeconds(end, clock), seconds);
    now += (seconds + 1) * 1000;
    assert.equal(restSeconds(end, clock), 0);
  }
});

test("the short card opens at the session threshold", () => {
  for (const sessions of [
    SHORT_CARD_SESSIONS - 1,
    SHORT_CARD_SESSIONS,
    SHORT_CARD_SESSIONS + 1,
  ])
    assert.equal(
      opensShort({ ...movement, card: { ...card, sessions } }),
      sessions >= SHORT_CARD_SESSIONS,
    );
});

test("Done patches the full set list and returns the server's sets", async () => {
  const older = existing.sets[0];
  assert.ok(older);
  const slot = guideSlot(0, 1);
  const response = {
    ...existing,
    sets: [...existing.sets, { ...older, set_index: 2, notes: slot, reps: 7 }],
  };
  const result = await saveGuideSet(
    workout,
    existing,
    { slot, exercise: row.exercise, set: row },
    undefined,
    async (id, sets) => {
      assert.equal(id, existing.id);
      assert.deepEqual(
        sets.map(({ notes, reps }) => [notes, reps]),
        [
          [older.notes, 8],
          [slot, 8],
        ],
      );
      return response;
    },
  );
  assert.equal(result, response);
});

test("starting the same scheduled workout twice posts the same client id", async () => {
  const ids: unknown[] = [];
  for (const planned of [workout, { ...workout }])
    await saveGuideSet(
      planned,
      null,
      { slot: guideSlot(0, 0), exercise: row.exercise, set: row },
      async (body) => {
        ids.push(body.client_id);
        return existing;
      },
    );
  assert.deepEqual(ids, [
    "guide:2026-01-05:upper_a",
    "guide:2026-01-05:upper_a",
  ]);
});

test("POST replay keeps a different movement at the same slot, and Undo tolerates a missing session", async () => {
  const slot = guideSlot(0, 0);
  const renamed = setInput(prescribedSet({ ...movement, name: "  Row  " }));
  assert.equal(renamed.exercise, "Row");
  await saveGuideSet(
    workout,
    null,
    { slot, exercise: renamed.exercise, set: renamed },
    async () => existing,
    async (id, sets) => {
      assert.equal(id, existing.id);
      assert.deepEqual(
        sets.map(({ exercise }) => exercise),
        ["Step up", "Row"],
      );
      return existing;
    },
  );
  assert.equal(
    await saveGuideSet(workout, null, {
      slot,
      exercise: row.exercise,
      set: null,
    }),
    null,
  );
});

test("Undo removes only the matching set and leaves the other exercise", async () => {
  const [first] = existing.sets;
  assert.ok(first);
  const other = { ...first, exercise: "Row", set_index: 2 };
  const activity = { ...existing, sets: [first, other] };
  const response = { ...existing, sets: [other] };
  const result = await saveGuideSet(
    workout,
    activity,
    { slot: guideSlot(0, 0), exercise: first.exercise, set: null },
    undefined,
    async (_id, sets) => {
      assert.deepEqual(
        sets.map((set) => set.exercise),
        ["Row"],
      );
      return response;
    },
  );
  assert.equal(result, response);
});
