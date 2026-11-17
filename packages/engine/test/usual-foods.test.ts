import assert from "node:assert/strict";
import { usualFoodsWindowDays } from "../src/days/usual-foods.ts";
import { shiftDay } from "../src/logging/day.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

test("usual foods rank by times logged in the window, per person, with the usual serving", async (context) => {
  const { database, admin, member } = await twoUsers(context, "fallback");
  const read = async (person: typeof admin) => {
    const response = await person.request("/api/foods/usual");
    assert.equal(response.status, 200);
    return response.json();
  };
  const { since, foods } = await read(admin);
  assert.deepEqual(foods, []);
  const today = shiftDay(since, usualFoodsWindowDays - 1);
  const food = database.prepare(
    "INSERT INTO foods (user_id, name, serving_size, serving_unit, kcal, provenance) VALUES (?, ?, 40, 'g', 150, 'label')",
  );
  const [oats, toast, soup] = (
    [
      [admin, "Example oats"],
      [admin, "Example toast"],
      [member, "Example member soup"],
    ] as const
  ).map(([person, name]) =>
    Number(food.run(person.user.id, name).lastInsertRowid),
  );
  const apple = Number(
    database
      .prepare(
        "INSERT INTO source_foods (source, source_key, name, kcal, provenance, fetched_at) VALUES ('usda', 'k1', 'Example apple', 95, 'label', '2026-01-01T00:00:00.000Z')",
      )
      .run().lastInsertRowid,
  );
  const entry = database.prepare(
    "INSERT INTO intake_entries (client_id, user_id, food_id, source_food_id, servings, day, eaten_at, provenance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, @at, 'label', @at, @at)",
  );
  const logs = [
    [admin, 2, oats, null, 2, today],
    [admin, 1, oats, null, 1, today],
    [admin, 2, null, apple, 0.5, today],
    [admin, 1, toast, null, 1, since],
    [admin, 5, toast, null, 1, shiftDay(since, -1)],
    [admin, 5, toast, null, 1, shiftDay(today, 1)],
    [member, 5, null, apple, 1, today],
    [member, 1, soup, null, 1, today],
  ] as const;
  let count = 0;
  for (const [person, times, ...row] of logs)
    for (let repeat = 0; repeat < times; repeat++) {
      const at = `${row[3]}T12:00:00.${String(++count).padStart(3, "0")}Z`;
      entry.run(`e${count}`, person.user.id, ...row, { at });
    }
  assert.deepEqual(
    (await read(admin)).foods.map((row: Record<string, unknown>) => [
      row.name,
      row.times_logged,
      row.usual_servings,
      row.serving,
    ]),
    [
      ["Example oats", 3, 2, { amount: 40, unit: "g" }],
      ["Example apple", 2, 0.5, null],
      ["Example toast", 1, 1, { amount: 40, unit: "g" }],
    ],
  );
  assert.deepEqual(
    (await read(member)).foods.map((row: { name: string }) => row.name),
    ["Example apple", "Example member soup"],
  );
});
