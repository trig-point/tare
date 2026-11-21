import assert from "node:assert/strict";
import { test } from "./support/hang-ceiling.ts";
import { orderMeal } from "./support/order-meals.ts";
import { json, pantryHarness } from "./support/pantry-fake.ts";
import { twoUsers } from "./support/two-users.ts";

test("estimated rice retains its reference and recomputes its calorie range", async (context) => {
  const { admin, database } = await twoUsers(context, "fallback");
  database
    .prepare(
      "INSERT INTO source_foods (id, source, source_key, name, serving_size, serving_unit, kcal, provenance, fetched_at) VALUES (1, 'usda', 'example', 'Example rice', 100, 'g', 130, 'verified', ?)",
    )
    .run("2026-01-01T00:00:00.000Z");
  const estimate = {
    client_id: "rice",
    source_food_id: 1,
    amount_estimated: true,
    servings: 3,
    servings_low: 2.5,
    servings_high: 3.5,
  };
  const log = (input: unknown) => json(admin, "/api/intake", input);
  const { status, body } = await log(estimate);
  assert.equal(status, 201, JSON.stringify(body));
  const { entry } = body;
  const path = `/api/intake/${entry.id}`;
  const edit = (input: unknown) => json(admin, path, input, "PATCH");
  const amount = (result: typeof entry) => [
    result.kcal,
    result.kcal_low,
    result.kcal_high,
    result.provenance,
    result.amount_estimated,
    result.servings_low,
    result.servings_high,
  ];
  assert.equal(entry.source_food_id, 1);
  assert.deepEqual(amount(entry), [390, 325, 455, "estimated", 1, 2.5, 3.5]);
  for (const extra of [
    { provenance: "verified" },
    { servings_low: null },
    { servings_high: 2 },
    { servings_high: undefined },
  ])
    assert.equal((await log({ ...estimate, ...extra })).status, 400);

  database.prepare("UPDATE source_foods SET kcal = 200 WHERE id = 1").run();
  assert.deepEqual(amount((await edit({ servings: 3.25 })).body.entry), [
    650,
    500,
    700,
    "estimated",
    1,
    2.5,
    3.5,
  ]);
  assert.equal(
    (await edit({ servings_low: 3.3, servings_high: 4 })).status,
    400,
  );
  assert.equal(
    (await edit({ amount_measured: true, servings_low: 3, servings_high: 4 }))
      .status,
    400,
  );
  assert.deepEqual(
    amount((await edit({ servings_low: 3, servings_high: 4 })).body.entry),
    [650, 600, 800, "estimated", 1, 3, 4],
  );
  assert.deepEqual(amount((await edit({ servings: 5 })).body.entry), [
    1000,
    null,
    null,
    "estimated",
    1,
    null,
    null,
  ]);

  database.prepare("UPDATE source_foods SET kcal = 130 WHERE id = 1").run();
  assert.deepEqual(
    amount((await edit({ servings: 2.8, amount_measured: true })).body.entry),
    [364, null, null, "verified", 0, null, null],
  );
  database.prepare("UPDATE source_foods SET kcal = 1e308 WHERE id = 1").run();
  assert.equal(
    (
      await log({
        ...estimate,
        client_id: "overflow",
        servings: 1,
        servings_low: 1,
      })
    ).status,
    400,
  );
  assert.equal(
    database.prepare("SELECT count(*) FROM intake_entries").pluck().get(),
    1,
  );
});

test("a bound catalog estimate skips pantry and remains scoped to its owner", async (context) => {
  const { admin, member, database, bind, kicks } = await pantryHarness(context);
  const { lastInsertRowid } = database
    .prepare(
      "INSERT INTO foods (user_id, name, provenance, kcal, kcal_low, kcal_high) VALUES (?, 'Example beans', 'estimated', 100, 80, 120)",
    )
    .run(admin.user.id);
  const food_id = Number(lastInsertRowid);
  bind("food", food_id, 7);
  const estimate = {
    client_id: "beans",
    food_id,
    servings: 3,
    amount_estimated: true,
    servings_low: 2,
    servings_high: 4,
  };
  assert.equal((await json(member, "/api/intake", estimate)).status, 404);
  const logged = await json(admin, "/api/intake", estimate);
  assert.equal(logged.status, 201, JSON.stringify(logged.body));
  const path = `/api/intake/${logged.body.entry.id}`;
  assert.deepEqual(
    [
      logged.body.entry.kcal_low,
      logged.body.entry.kcal_high,
      logged.body.stock,
    ],
    [160, 480, undefined],
  );
  assert.equal(
    (await json(member, path, { amount_measured: true }, "PATCH")).status,
    404,
  );
  const { body: measured } = await json(
    admin,
    path,
    { amount_measured: true },
    "PATCH",
  );
  assert.deepEqual(
    [
      measured.entry.amount_estimated,
      measured.entry.provenance,
      measured.entry.kcal_low,
      measured.entry.kcal_high,
      measured.stock,
    ],
    [0, "estimated", 240, 360, undefined],
  );
  assert.deepEqual(
    database
      .prepare(
        "SELECT (SELECT count(*) FROM pantry_requests) AS requests, (SELECT count(*) FROM pantry_outcomes) AS outcomes",
      )
      .get(),
    { requests: 0, outcomes: 0 },
  );
  assert.deepEqual(kicks, []);
  const ordinary = await json(admin, "/api/intake", {
    client_id: "ordinary",
    food_id,
    servings: 3,
  });
  assert.equal(ordinary.body.entry.amount_estimated, 0);
  assert.equal(ordinary.body.stock.state, "pending");
  assert.equal(
    (
      await json(
        admin,
        `/api/intake/${ordinary.body.entry.id}`,
        { amount_measured: true },
        "PATCH",
      )
    ).status,
    400,
  );
});

test("eat_meal replays an intake receipt saved before amount estimates", async (context) => {
  const { admin, database } = await twoUsers(context, "fallback");
  const meal_id = await orderMeal(
    database,
    admin,
    "2026-01-01",
    1,
    "2026-01-01T00:00:00.000Z",
  );
  const input = { meal_id, revision: 1, action: "ate", mutation_id: "legacy" };
  const before = await json(admin, "/api/meals/eat", input);
  assert.equal(before.status, 200, JSON.stringify(before.body));
  database
    .prepare(
      "UPDATE meal_actions SET result = json_remove(result, '$.entry.amount_estimated', '$.entry.servings_low', '$.entry.servings_high') WHERE mutation_id = ?",
    )
    .run(input.mutation_id);
  assert.deepEqual(await json(admin, "/api/meals/eat", input), before);
});
