import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { writeTransaction } from "../src/db.ts";
import { insertOwnedFood } from "../src/foods/create.ts";
import { insertSourceFood } from "../src/queries/insert-source-food.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const rice = {
  mutation_id: "6f1c2a4e-8b3d-4c5e-9f10-2a3b4c5d6e7f",
  name: "Example jasmine rice",
  serving_size: 0.25,
  serving_unit: "cup",
  kcal: 160,
  carbs_g: 36,
  provenance: "label",
  source: "Example package label",
};
async function setup(context: TestContext) {
  const users = await twoUsers(context, "fallback");
  const post = async (path: string, body: unknown, person = users.admin) => {
    const response = await person.request(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const result = await response.json();
    return { status: response.status, ...result };
  };
  const counts = () =>
    users.database
      .prepare(
        "SELECT (SELECT count(*) FROM foods) AS foods, (SELECT count(*) FROM food_receipts) AS receipts",
      )
      .get();
  return { ...users, post, counts };
}

test("create_food stores owned foods with replayable, owner-scoped receipts", async (context) => {
  const { member, post, counts } = await setup(context);
  const created = await post("/api/foods", rice);
  assert.equal(created.status, 201);
  assert.equal(created.food.protein_g, null);
  assert.equal(created.food.serving_unit, "cup");
  const upper = { ...rice, mutation_id: rice.mutation_id.toUpperCase() };
  for (const replay of [rice, upper])
    assert.deepEqual(await post("/api/foods", replay), {
      ...created,
      status: 200,
      created: false,
    });
  assert.equal(
    (await post("/api/foods", { ...rice, kcal: 170 })).error.code,
    "mutation_conflict",
  );
  assert.deepEqual(counts(), { foods: 1, receipts: 1 });
  const theirs = await post("/api/foods", rice, member);
  assert.notEqual(theirs.food.id, created.food.id);
  const log = { client_id: "log", food_id: created.food.id, servings: 2 };
  assert.equal((await post("/api/intake", log, member)).status, 404);
  const { entry } = await post("/api/intake", log);
  assert.deepEqual([entry.kcal, entry.carbs_g, entry.fat_g], [320, 72, null]);
});

test("create_food rejects unusable label values without leaving a food or receipt", async (context) => {
  const { database, admin, post, counts } = await setup(context);
  const refusal = async (body: unknown) =>
    (await post("/api/foods", body)).error?.code;
  const { kcal: _kcal, ...withoutKcal } = rice;
  assert.equal(await refusal(withoutKcal), "invalid_request");
  assert.equal(
    await refusal({ ...rice, source: undefined }),
    "label_source_required",
  );
  assert.equal(
    await refusal({ ...rice, kcal: null, carbs_g: null }),
    "invalid_request",
  );
  const evidence = insertSourceFood(database, {
    source: "off",
    source_key: "0000000000017",
    name: "Example oats",
    brand: null,
    serving_size: 100,
    serving_unit: "g",
    kcal: 380,
    protein_g: 13,
    carbs_g: 68,
    fat_g: 7,
    fiber_g: 10,
    provenance: "label",
    fetched_at: "2026-01-01T00:00:00.000Z",
  });
  assert.ok(evidence);
  const fromEvidence = { ...rice, source_food_id: evidence.id };
  assert.equal(await refusal(fromEvidence), "serving_basis_mismatch");
  assert.throws(() =>
    writeTransaction(database, (scope) => {
      insertOwnedFood(scope, admin.user.id, {
        ...rice,
        provenance: "label",
        protein_g: null,
        fat_g: null,
        fiber_g: null,
        kcal_low: null,
        kcal_high: null,
        source_food_id: null,
      });
      throw new Error("Caller failed after the food insert");
    }),
  );
  assert.deepEqual(counts(), { foods: 0, receipts: 0 });
  const matching = { ...fromEvidence, serving_size: 100, serving_unit: "g" };
  assert.equal((await post("/api/foods", matching)).status, 201);
});
