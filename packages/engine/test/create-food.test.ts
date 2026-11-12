import assert from "node:assert/strict";
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
  protein_g: 3,
  provenance: "label",
  source: "Example package label",
};

test("create_food stores owned foods with replayable, owner-scoped receipts", async (context) => {
  const { database, admin, member } = await twoUsers(context, "fallback");
  const send = async (
    person: typeof admin,
    path: string,
    body: unknown,
    status: number,
  ) => {
    const response = await person.request(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  };
  const counts = () =>
    database
      .prepare(
        "SELECT (SELECT count(*) FROM foods) AS foods, (SELECT count(*) FROM food_receipts) AS receipts",
      )
      .get();

  const created = await send(admin, "/api/foods", rice, 201);
  assert.equal(created.created, true);
  assert.deepEqual(
    {
      ...created.food,
      id: undefined,
    },
    {
      id: undefined,
      name: rice.name,
      serving_size: 0.25,
      serving_unit: "cup",
      kcal: 160,
      protein_g: 3,
      carbs_g: 36,
      fat_g: null,
      fiber_g: null,
      kcal_low: null,
      kcal_high: null,
      provenance: "label",
      source: rice.source,
      source_food_id: null,
    },
  );
  assert.deepEqual(await send(admin, "/api/foods", rice, 200), {
    ...created,
    created: false,
  });
  assert.deepEqual(
    await send(admin, "/api/foods", { ...rice, kcal: 170 }, 409),
    { error: { code: "mutation_conflict" } },
  );
  assert.deepEqual(counts(), { foods: 1, receipts: 1 });

  const memberFood = await send(member, "/api/foods", rice, 201);
  assert.notEqual(memberFood.food.id, created.food.id);
  const log = (person: typeof admin, id: number, status: number) =>
    send(
      person,
      "/api/intake",
      { client_id: `log-${id}`, food_id: id, servings: 2 },
      status,
    );
  assert.equal(
    (await log(member, created.food.id, 404)).error.code,
    "food_not_found",
  );
  const entry = (await log(admin, created.food.id, 201)).entry;
  assert.equal(entry.kcal, 320);
  assert.equal(entry.carbs_g, 72);
  assert.equal(entry.fat_g, null);
  assert.equal(entry.provenance, "label");
});

test("create_food rejects unusable label values without leaving a food or receipt", async (context) => {
  const { database, admin } = await twoUsers(context, "fallback");
  const send = async (body: unknown) => {
    const response = await admin.request("/api/foods", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return [response.status, (await response.json()).error?.code];
  };
  const { kcal: _kcal, ...withoutKcal } = rice;
  assert.deepEqual((await send(withoutKcal))[0], 400);
  assert.deepEqual(await send({ ...rice, source: undefined }), [
    400,
    "label_source_required",
  ]);
  assert.deepEqual(
    await send({ ...rice, kcal: null, carbs_g: undefined, protein_g: null }),
    [400, "invalid_request"],
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
  assert.deepEqual(await send({ ...rice, source_food_id: evidence.id }), [
    400,
    "serving_basis_mismatch",
  ]);
  assert.throws(() =>
    writeTransaction(database, (scope) => {
      insertOwnedFood(scope, admin.user.id, {
        ...rice,
        provenance: "label",
        fat_g: null,
        fiber_g: null,
        kcal_low: null,
        kcal_high: null,
        source_food_id: null,
      });
      throw new Error("Caller failed after the food insert");
    }),
  );
  assert.deepEqual(
    database
      .prepare(
        "SELECT (SELECT count(*) FROM foods) AS foods, (SELECT count(*) FROM food_receipts) AS receipts",
      )
      .get(),
    { foods: 0, receipts: 0 },
  );
  assert.deepEqual(
    await send({
      ...rice,
      serving_size: 100,
      serving_unit: "g",
      source_food_id: evidence.id,
    }),
    [201, undefined],
  );
});
