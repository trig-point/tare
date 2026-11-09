import assert from "node:assert/strict";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const day = "2026-01-01";
const habit = { habit_key: "evening_alcohol", day };

test("habit notes are stored, replaced and deleted per person, and unknown keys are rejected", async (context) => {
  const { admin, member } = await twoUsers(context, "fallback");
  const send = async (
    person: typeof admin,
    method: string,
    path: string,
    body?: unknown,
  ) => {
    const response = await person.request(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const read = async (person: typeof admin) =>
    (await send(person, "GET", `/api/signals/${day}`)).body;
  const remove = (key: string) =>
    send(admin, "DELETE", `/api/habits/${day}/${key}`);
  await send(member, "POST", "/api/habits", { ...habit, amount: 1 });
  const memberBefore = await read(member);
  const [memberRow] = memberBefore.habits;
  assert.deepEqual(
    [memberRow.amount, memberRow.note, memberRow.source],
    [1, null, "manual"],
  );
  assert.deepEqual((await read(admin)).habits, []);
  const first = await send(admin, "POST", "/api/habits", {
    ...habit,
    amount: 2,
  });
  assert.deepEqual([first.status, first.body.amount], [200, 2]);
  const again = await send(admin, "POST", "/api/habits", {
    ...habit,
    amount: 3,
    note: "with dinner",
  });
  assert.deepEqual((await read(admin)).habits, [
    {
      habit_key: "evening_alcohol",
      amount: 3,
      note: "with dinner",
      source: "manual",
      updated_at: again.body.updated_at,
    },
  ]);
  assert.deepEqual(await remove("evening_alcohol"), {
    status: 200,
    body: { deleted: true, ...habit },
  });
  assert.equal((await remove("evening_alcohol")).status, 404);
  const unknown = { status: 400, body: { error: { code: "unknown_habit" } } };
  assert.deepEqual(
    await send(admin, "POST", "/api/habits", { habit_key: "late_workout" }),
    unknown,
  );
  assert.deepEqual(await remove("late_workout"), unknown);
  assert.deepEqual(await read(admin), {
    day,
    signals: [],
    activities: [],
    habits: [],
  });
  assert.deepEqual(await read(member), memberBefore);
});
