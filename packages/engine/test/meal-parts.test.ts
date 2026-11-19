import assert from "node:assert/strict";
import { mcpSession } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { json } from "./support/pantry-fake.ts";
import { twoUsers } from "./support/two-users.ts";

const path = "/api/intake/meal-parts";
const now = "2026-01-01T12:00:00.000Z";
const lunch = {
  client_id: "takeout-lunch",
  meal_note: "Takeout lunch",
  parts: [
    { source_food_id: 1, grams: 300, grams_low: 250, grams_high: 350 },
    { source_food_id: 2, grams: 170, grams_low: 140, grams_high: 200 },
  ],
};

test("takeout lunch logs two estimated source foods and totals their ranges", async (context) => {
  const { admin, database } = await twoUsers(context, "fallback");
  database
    .prepare(
      "INSERT INTO source_foods (id, source, source_key, name, serving_size, serving_unit, kcal, protein_g, provenance, fetched_at) VALUES (1, 'usda', 'rice', 'Example rice', 100, 'g', 130, NULL, 'verified', ?), (2, 'usda', 'chicken', 'Example chicken', 100, 'g', 160, 30, 'verified', ?)",
    )
    .run(now, now);
  const response = await json(admin, path, lunch);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const { entries, totals, kcal_range } = response.body;
  assert.deepEqual(
    entries.map((entry: (typeof entries)[number]) => [
      entry.source_food_id,
      entry.amount_estimated,
      entry.provenance,
      entry.kcal_low,
      entry.kcal_high,
    ]),
    [
      [1, 1, "estimated", 325, 455],
      [2, 1, "estimated", 224, 320],
    ],
  );
  assert.equal(entries[0].eaten_at, entries[1].eaten_at);
  assert.equal(
    entries[0].portion_note,
    "Estimated 300 g (250 to 350 g). Takeout lunch",
  );
  assert.deepEqual(totals.kcal, {
    total: 662,
    complete: true,
    known_subtotal: 662,
  });
  assert.deepEqual(totals.protein_g, {
    total: null,
    complete: false,
    known_subtotal: 51,
  });
  assert.deepEqual(kcal_range, { low: 549, high: 775 });
});

test("meal receipts replay in order and preserve the intake ID namespace", async (context) => {
  const { admin, database } = await twoUsers(context, "fallback");
  const { lastInsertRowid } = database
    .prepare(
      "INSERT INTO foods (user_id, name, serving_size, serving_unit, provenance, kcal) VALUES (?, 'Example rice', 100, 'g', 'estimated', 130)",
    )
    .run(admin.user.id);
  const legacy = "meal-part:1:1";
  database
    .prepare(
      "INSERT INTO intake_entries (user_id, client_id, eaten_at, day, name, provenance, kcal, created_at, updated_at) VALUES (?, ?, ?, '2026-01-01', 'Example legacy rice', 'estimated', 123, ?, ?)",
    )
    .run(admin.user.id, legacy, now, now, now);
  const ordinary = { client_id: legacy, name: "Example rice", kcal: 100 };
  const oldRetry = await json(admin, "/api/intake", ordinary);
  assert.equal(oldRetry.status, 200);
  assert.equal(oldRetry.body.entry.kcal, 123);
  assert.equal(
    (
      await json(admin, "/api/intake", {
        ...ordinary,
        client_id: "meal-part:new:1",
      })
    ).status,
    400,
  );

  const part = { food_id: Number(lastInsertRowid), grams: 100 };
  const input = {
    client_id: "receipt",
    parts: [part, { ...part, grams: 200 }],
  };
  const log = (value: unknown) => json(admin, path, value);
  const first = await log(input);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.kcal_range, null);
  assert.notEqual(first.body.entries[0].client_id, legacy);
  assert.equal(
    database.prepare("SELECT count(*) FROM intake_entries").pluck().get(),
    3,
  );
  const replay = await log({
    parts: [{ grams: 100, food_id: part.food_id }, input.parts[1]],
    client_id: input.client_id,
  });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, first.body);
  for (const change of [
    {
      parts: [
        { ...part, grams: 200 },
        { ...part, grams: 200 },
      ],
    },
    { eaten_at: first.body.entries[0].eaten_at },
  ]) {
    assert.deepEqual(await log({ ...input, ...change }), {
      status: 409,
      body: { error: { code: "mutation_conflict" } },
    });
  }
  const deleted = await admin.request(
    `/api/intake/${first.body.entries[1].id}`,
    { method: "DELETE" },
  );
  assert.equal(deleted.status, 200);
  assert.deepEqual(await log(input), {
    status: 409,
    body: { error: { code: "meal_part_deleted" } },
  });
  assert.equal(
    database.prepare("SELECT count(*) FROM intake_entries").pluck().get(),
    2,
  );
});

test("part failures agree over HTTP and MCP and roll back the meal", async (context) => {
  const setup = await twoUsers(context, "access");
  const { admin, member, database } = setup;
  const client = await mcpSession(context, setup, admin.user.id);
  const seed = database
    .prepare(
      "INSERT INTO foods (user_id, name, serving_size, serving_unit, provenance, kcal) VALUES (?, 'Example food', ?, ?, 'estimated', ?) RETURNING id",
    )
    .pluck();
  const owned = seed.get(admin.user.id, 100, "g", 130);
  const part = { food_id: owned, grams: 100 };
  const volume = seed.get(admin.user.id, 100, "ml", 130);
  const missing = seed.get(admin.user.id, null, "g", 130);
  const foreign = seed.get(member.user.id, 100, "g", 130);
  const large = {
    food_id: seed.get(admin.user.id, 100, "g", 1.04e308),
    grams: 100,
  };
  for (const [code, status, parts, position, clientId] of [
    ["invalid_part", 400, [part, null], 2],
    ["invalid_part", 400, [part, null], 2, ""],
    ["invalid_part", 400, [part, { ...part, grams_low: 90 }], 2],
    ["dimension_mismatch", 400, [part, { ...part, food_id: volume }, part], 2],
    ["no_serving_basis", 400, [part, { ...part, food_id: missing }], 2],
    ["food_not_found", 404, [part, part, { ...part, food_id: foreign }], 3],
    ["amount_out_of_range", 400, [part, { ...large, grams: 200 }], 2],
    ["amount_out_of_range", 400, [large, large], 2],
  ] as const) {
    const args = { client_id: clientId ?? "failed-meal", parts };
    const body = { error: { code, part: position } };
    assert.deepEqual(await json(admin, path, args), { status, body });
    const reply = await client.callTool({
      name: "log_meal_parts",
      arguments: args,
    });
    assert.equal(reply.isError, true);
    assert.deepEqual(reply.content, [
      { type: "text", text: JSON.stringify(body) },
    ]);
    assert.deepEqual(
      database
        .prepare(
          "SELECT (SELECT count(*) FROM intake_entries) AS entries, (SELECT count(*) FROM meal_receipts) AS receipts",
        )
        .get(),
      { entries: 0, receipts: 0 },
    );
  }
  for (const parts of [undefined, null, []]) {
    const args = { client_id: "empty", parts };
    const body = { error: { code: "invalid_request" } };
    assert.deepEqual(await json(admin, path, args), { status: 400, body });
    const reply = await client.callTool({
      name: "log_meal_parts",
      arguments: args,
    });
    assert.deepEqual(reply.content, [
      { type: "text", text: JSON.stringify(body) },
    ]);
  }
});
