import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const day = "2026-01-01";

async function habitPeople(context: TestContext) {
  const { admin, member } = await twoUsers(context, "fallback");
  const client = (person: typeof admin) => ({
    user: person.user,
    async send(method: string, path: string, body?: unknown) {
      const response = await person.request(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    async habits() {
      return (await this.send("GET", `/api/signals/${day}`)).body.habits;
    },
  });
  return { personA: client(admin), personB: client(member) };
}

test("logging a habit stores its amount and source", async (context) => {
  const { personA } = await habitPeople(context);
  const logged = await personA.send("POST", "/api/habits", {
    habit_key: "evening_alcohol",
    day,
    amount: 2,
  });
  assert.equal(logged.status, 200);
  assert.deepEqual(
    [logged.body.user_id, logged.body.day, logged.body.amount],
    [personA.user.id, day, 2],
  );
  assert.deepEqual(await personA.habits(), [
    {
      habit_key: "evening_alcohol",
      amount: 2,
      note: null,
      source: "manual",
      updated_at: logged.body.updated_at,
    },
  ]);
});

test("logging the same habit again updates the one row", async (context) => {
  const { personA } = await habitPeople(context);
  const habit = { habit_key: "evening_alcohol", day };
  await personA.send("POST", "/api/habits", { ...habit, amount: 2 });
  await personA.send("POST", "/api/habits", {
    ...habit,
    amount: 3,
    note: "with dinner",
  });
  assert.deepEqual(
    (await personA.habits()).map((row: { amount: number; note: string }) => [
      row.amount,
      row.note,
    ]),
    [[3, "with dinner"]],
  );
});

test("deleting a habit leaves the day not logged", async (context) => {
  const { personA } = await habitPeople(context);
  await personA.send("POST", "/api/habits", {
    habit_key: "late_caffeine",
    day,
  });
  assert.deepEqual(
    await personA.send("DELETE", `/api/habits/${day}/late_caffeine`),
    {
      status: 200,
      body: { deleted: true, day, habit_key: "late_caffeine" },
    },
  );
  assert.deepEqual(await personA.habits(), []);
});

test("an unknown habit key is rejected with a stable code", async (context) => {
  const { personA } = await habitPeople(context);
  const unknown = { status: 400, body: { error: { code: "unknown_habit" } } };
  assert.deepEqual(
    await personA.send("POST", "/api/habits", { habit_key: "late_workout" }),
    unknown,
  );
  assert.deepEqual(
    await personA.send("DELETE", `/api/habits/${day}/late_workout`),
    unknown,
  );
  assert.deepEqual(await personA.habits(), []);
});

test("a day with no habit row has no habit value in the response", async (context) => {
  const { personA } = await habitPeople(context);
  assert.deepEqual((await personA.send("GET", `/api/signals/${day}`)).body, {
    day,
    signals: [],
    activities: [],
    habits: [],
  });
});

test("one person cannot read, replace or delete another person's habit notes", async (context) => {
  const { personA, personB } = await habitPeople(context);
  const habit = { habit_key: "evening_alcohol", day };
  await personB.send("POST", "/api/habits", { ...habit, amount: 1 });
  const before = await personB.habits();
  assert.deepEqual(await personA.habits(), []);
  const replaced = await personA.send("POST", "/api/habits", {
    ...habit,
    amount: 4,
  });
  assert.equal(replaced.body.user_id, personA.user.id);
  assert.equal(
    (await personA.send("DELETE", `/api/habits/${day}/evening_alcohol`)).status,
    200,
  );
  assert.equal(
    (await personA.send("DELETE", `/api/habits/${day}/evening_alcohol`)).status,
    404,
  );
  assert.deepEqual(await personB.habits(), before);
});
