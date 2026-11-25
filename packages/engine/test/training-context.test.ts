import assert from "node:assert/strict";
import { trainingContextOutput } from "../src/workout/training-context.ts";
import { accessFixture, mcpSession } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { exampleSchedule } from "./support/workout-schedule.ts";

test("training records and workout context through MCP", async (context) => {
  const setup = accessFixture(context);
  const client = await mcpSession(context, setup, setup.admin.id);
  const invoke = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await invoke(name, args);
    assert.equal(result.isError, undefined, JSON.stringify(result.content));
    return result.structuredContent;
  };
  const read = async () =>
    trainingContextOutput.parse(await call("get_training_context"));
  assert.deepEqual(await read(), {
    places: [],
    limits: [],
    schedule: null,
    recent_sessions: [],
  });

  const place = { id: 1, name: "Home", notes: null };
  const machine = {
    id: 1,
    place_id: place.id,
    name: "Example rower",
    notes: null,
    photo_urls: ["https://example.com/rower.jpg"],
    movements: ["Row"],
  };
  const limit = {
    id: 1,
    body_area: "Example shoulder",
    description: "Discomfort overhead",
    status: "active",
    movements: ["Overhead press"],
    date_noted: "2026-01-01",
  };
  const { id: _placeId, ...placeInput } = place;
  const { id: _machineId, ...machineInput } = machine;
  const { id: _limitId, ...limitInput } = limit;

  for (const [name, args, code] of [
    ["save_training_machine", machineInput, "place_not_found"],
    [
      "save_training_machine",
      { ...machineInput, photo_urls: ["file:///example"] },
      "Invalid URL",
    ],
  ] as const) {
    const result = await invoke(name, args);
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), new RegExp(code));
  }

  assert.deepEqual(await call("save_training_place", placeInput), { place });
  assert.deepEqual(await call("save_training_place", place), { place });
  const spare = { place_id: place.id, name: "Spare rower" };
  await call("save_training_machine", machineInput);
  assert.deepEqual(await call("save_training_machine", machine), { machine });
  await call("save_training_machine", spare);
  await call("remove_training_machine", { id: 2 });
  assert.deepEqual(await call("save_training_limit", limitInput), { limit });
  await call("replace_workout_schedule", exampleSchedule());
  for (const day of ["25", "26", "27", "28", "29", "30"]) {
    await call("log_activity", {
      day: `2025-12-${day}`,
      timing: "date_only",
      kind: "strength",
      sets: [{ exercise: "Example row", reps: Number(day) }],
    });
  }

  const training = await read();
  const placeWithMachines = { ...place, machines: [machine] };
  assert.deepEqual(training.places, [placeWithMachines]);
  assert.deepEqual(training.limits, [limit]);
  const matched = training.schedule?.sessions.push_a;
  const unmatched = training.schedule?.sessions.legs_a;
  assert.deepEqual(matched?.place, placeWithMachines);
  assert.equal(unmatched?.place, null);
  assert.equal(unmatched.where, "example gym");
  const recent = training.recent_sessions;
  assert.deepEqual(
    recent.map((session) => session.sets[0]?.reps),
    [30, 29, 28, 27, 26],
  );

  await call("save_training_limit", { ...limit, status: "resolved" });
  assert.deepEqual((await read()).limits, []);
  await call("remove_training_limit", { id: limit.id });
  await call("remove_training_place", { id: place.id });
  assert.deepEqual((await read()).places, []);
  assert.equal(
    (await invoke("remove_training_machine", { id: machine.id })).isError,
    true,
  );
});
