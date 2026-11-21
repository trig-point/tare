import assert from "node:assert/strict";
import { insertSourceFood } from "../src/queries/insert-source-food.ts";
import { mcpSession } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { json } from "./support/pantry-fake.ts";
import { twoUsers } from "./support/two-users.ts";

const path = "/api/foods/batch";
const batch = {
  mutation_id: "6f1c2a4e-8b3d-4c5e-9f10-2a3b4c5d6e7f",
  name: " Example bean and rice batch ",
  cooked_grams: 400,
};
const rice = {
  mutation_id: "9f1c2a4e-8b3d-4c5e-9f10-2a3b4c5d6e7f",
  name: "Example rice",
  serving_size: 0.1,
  serving_unit: "kg",
  kcal: 120,
  kcal_low: 110,
  kcal_high: 130,
  protein_g: 4,
  carbs_g: 25,
  fat_g: 0,
  provenance: "estimated",
};

test("two weighed ingredients produce a food with the batch nutrition per 100 g", async (context) => {
  const { admin, database } = await twoUsers(context, "fallback");
  const beans = insertSourceFood(database, {
    source: "usda",
    source_key: "example-beans",
    brand: null,
    name: "Example beans",
    serving_size: 50,
    serving_unit: "g",
    kcal: 60,
    protein_g: 5,
    carbs_g: 10,
    fat_g: 0,
    fiber_g: 3,
    provenance: "verified",
    fetched_at: "2026-01-01T12:00:00.000Z",
  });
  assert.ok(beans);
  const owned = await json(admin, "/api/foods", rice);
  assert.equal(owned.status, 201);
  const input = {
    ...batch,
    ingredients: [
      { source_food_id: beans.id, grams: 150 },
      { food_id: owned.body.food.id, grams: 200 },
    ],
  };
  const saved = await json(admin, path, input);
  assert.equal(saved.status, 201);
  const { id, ...food } = saved.body.food;
  assert.deepEqual(food, {
    name: batch.name.trim(),
    serving_size: 100,
    serving_unit: "g",
    kcal: 105,
    protein_g: 5.75,
    carbs_g: 20,
    fat_g: 0,
    fiber_g: null,
    kcal_low: null,
    kcal_high: null,
    provenance: "estimated",
    source: "Home recipe: 2 ingredients, 400 g cooked",
    source_food_id: null,
  });
  assert.equal(saved.body.created, true);
  const logged = await json(admin, "/api/intake", {
    client_id: "example-batch",
    food_id: id,
    servings: batch.cooked_grams / 100,
  });
  assert.equal(logged.status, 201);
  assert.equal(logged.body.entry.kcal, 420);
  assert.equal(logged.body.entry.amount_estimated, 0);

  const edited = await admin.request(`/api/foods/${owned.body.food.id}`, {
    method: "PATCH",
    body: JSON.stringify({ kcal: null }),
  });
  assert.equal(edited.status, 200);
  const replay = await json(admin, path, {
    ...input,
    mutation_id: input.mutation_id.toUpperCase(),
    name: input.name.trim(),
    ingredients: [
      { grams: 150, source_food_id: beans.id },
      input.ingredients[1],
    ],
  });
  assert.deepEqual(replay, {
    status: 200,
    body: { food: saved.body.food, created: false },
  });
  assert.deepEqual(
    await json(admin, path, {
      ...input,
      ingredients: input.ingredients.toReversed(),
    }),
    { status: 409, body: { error: { code: "mutation_conflict" } } },
  );
});

test("batch ingredient refusals preserve position and leave foods and receipts unchanged", async (context) => {
  const setup = await twoUsers(context, "access");
  const { admin, member, database } = setup;
  const client = await mcpSession(context, setup, admin.user.id);
  const seed = database
    .prepare(
      "INSERT INTO foods (user_id, name, serving_size, serving_unit, provenance, kcal, protein_g) VALUES (?, 'Example ingredient', ?, ?, 'estimated', ?, ?) RETURNING id",
    )
    .pluck();
  const standard = {
    food_id: seed.get(admin.user.id, 1, "g", 1, 0),
    grams: 100,
  };
  const volume = seed.get(admin.user.id, 100, "ml", 100, 0);
  const missing = seed.get(admin.user.id, null, null, 100, 0);
  const unknown = seed.get(admin.user.id, 100, "g", null, 10);
  const foreign = seed.get(member.user.id, 100, "g", 100, 0);
  const tiny = seed.get(admin.user.id, 1, "g", Number.MIN_VALUE, 0);
  const dense = seed.get(admin.user.id, 1, "g", 1, 1);
  const counts = () =>
    database
      .prepare(
        "SELECT (SELECT count(*) FROM foods) AS foods, (SELECT count(*) FROM food_receipts) AS receipts",
      )
      .get();
  const before = counts();
  for (const [ingredient, code, status, cooked_grams, part] of [
    [{ ...standard, source_food_id: 1 }, "invalid_part", 400, 400, 2],
    [{ ...standard, food_id: volume }, "dimension_mismatch", 400, 400, 2],
    [{ ...standard, food_id: missing }, "no_serving_basis", 400, 400, 2],
    [{ ...standard, food_id: unknown }, "ingredient_kcal_unknown", 400, 400, 2],
    [{ ...standard, food_id: foreign }, "food_not_found", 404, 400, 2],
    [{ food_id: tiny, grams: 0.25 }, "amount_out_of_range", 400, 400, 2],
    [{ food_id: tiny, grams: 1 }, "amount_out_of_range", 400, 100_000, 2],
    [standard, "cooked_weight_too_low", 400, 20, undefined],
    [
      { ...standard, food_id: dense },
      "cooked_weight_too_low",
      400,
      80,
      undefined,
    ],
  ] as const) {
    const first =
      cooked_grams === 100_000 ? { food_id: tiny, grams: 1 } : standard;
    const args = { ...batch, cooked_grams, ingredients: [first, ingredient] };
    const body = { error: part === undefined ? { code } : { code, part } };
    assert.deepEqual(await json(admin, path, args), { status, body });
    const reply = await client.callTool({
      name: "save_batch_food",
      arguments: args,
    });
    assert.equal(reply.isError, true);
    assert.deepEqual(reply.content, [
      { type: "text", text: JSON.stringify(body) },
    ]);
    assert.deepEqual(counts(), before);
  }
  for (const ingredients of [undefined, null, []])
    assert.deepEqual(await json(admin, path, { ...batch, ingredients }), {
      status: 400,
      body: { error: { code: "invalid_request" } },
    });

  for (const [name, cooked_grams, ingredients, expectedStatus] of [
    [
      "known macro subtotal still limits batches with an unknown macro",
      100,
      [
        { food_id: seed.get(admin.user.id, 100, "g", 100, 55), grams: 200 },
        { food_id: seed.get(admin.user.id, 100, "g", 1, null), grams: 10 },
      ],
      400,
    ],
    [
      "accepts the exact calorie limit",
      7,
      [{ food_id: seed.get(admin.user.id, 100, "g", 900, 0), grams: 7 }],
      201,
    ],
    [
      "accepts the exact macro limit",
      7,
      [{ food_id: seed.get(admin.user.id, 100, "g", 400, 100), grams: 7 }],
      201,
    ],
  ] as const) {
    await context.test(name, async () => {
      const before = counts();
      const response = await json(admin, path, {
        ...batch,
        mutation_id: crypto.randomUUID(),
        cooked_grams,
        ingredients,
      });
      assert.equal(response.status, expectedStatus);
      if (expectedStatus === 400) {
        assert.deepEqual(response.body, {
          error: { code: "cooked_weight_too_low" },
        });
        assert.deepEqual(counts(), before);
      }
    });
  }
});
