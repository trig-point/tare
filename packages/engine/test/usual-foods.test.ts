import assert from "node:assert/strict";
import type { Database } from "better-sqlite3";
import { usualFoodsWindowDays } from "../src/days/usual-foods.ts";
import { shiftDay } from "../src/logging/day.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

function seeder(database: Database) {
  const food = database.prepare(
    "INSERT INTO foods (user_id, name, serving_size, serving_unit, kcal, protein_g, provenance) VALUES (?, ?, ?, ?, ?, ?, 'label')",
  );
  const entry = database.prepare(
    "INSERT INTO intake_entries (user_id, client_id, food_id, source_food_id, servings, eaten_at, day, provenance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'label', ?, ?)",
  );
  let count = 0;
  return {
    food: (user: number, name: string) =>
      Number(food.run(user, name, 40, "g", 150, 5).lastInsertRowid),
    log(
      user: number,
      day: string,
      reference: { food?: number; source?: number },
      servings: number | null = 1,
    ) {
      count++;
      const at = `${day}T12:00:${String(count % 60).padStart(2, "0")}.${String(count).padStart(3, "0")}Z`;
      entry.run(
        user,
        `entry-${count}`,
        reference.food ?? null,
        reference.source ?? null,
        servings,
        at,
        day,
        at,
        at,
      );
    },
  };
}

test("usual foods rank by times logged in the window, per person, with the usual serving", async (context) => {
  const { database, admin, member } = await twoUsers(context, "fallback");
  const read = async (person: typeof admin) => {
    const response = await person.request("/api/foods/usual");
    assert.equal(response.status, 200);
    return response.json();
  };
  const empty = await read(admin);
  assert.deepEqual(empty.foods, []);
  const today = shiftDay(empty.since, usualFoodsWindowDays - 1);
  const seed = seeder(database);
  const oats = seed.food(admin.user.id, "Example oats");
  const toast = seed.food(admin.user.id, "Example toast");
  const memberFood = seed.food(member.user.id, "Example member soup");
  const source = Number(
    database
      .prepare(
        "INSERT INTO source_foods (source, source_key, name, brand, kcal, provenance, fetched_at) VALUES ('usda', 'k1', 'Example apple', 'Example farm', 95, 'label', '2026-01-01T00:00:00.000Z')",
      )
      .run().lastInsertRowid,
  );
  for (const servings of [2, 2, 1])
    seed.log(admin.user.id, today, { food: oats }, servings);
  for (let index = 0; index < 2; index++)
    seed.log(admin.user.id, today, { source }, 0.5);
  seed.log(admin.user.id, empty.since, { food: toast });
  for (let index = 0; index < 5; index++) {
    seed.log(admin.user.id, shiftDay(empty.since, -1), { food: toast });
    seed.log(admin.user.id, shiftDay(today, 1), { food: toast });
    seed.log(member.user.id, today, { source });
  }
  seed.log(member.user.id, today, { food: memberFood });
  const ranked = await read(admin);
  assert.deepEqual(
    ranked.foods.map(
      (food: {
        name: string;
        times_logged: number;
        usual_servings: number;
      }) => [food.name, food.times_logged, food.usual_servings],
    ),
    [
      ["Example oats", 3, 2],
      ["Example apple", 2, 0.5],
      ["Example toast", 1, 1],
    ],
  );
  assert.deepEqual(ranked.foods[0].serving, { amount: 40, unit: "g" });
  assert.deepEqual(ranked.foods[1].serving, null);
  assert.deepEqual(
    (await read(member)).foods.map((food: { name: string }) => food.name),
    ["Example apple", "Example member soup"],
  );
});
