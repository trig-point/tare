import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { writeTransaction } from "../src/db.ts";
import { mealNutritionKinds } from "../src/meal-nutrition/index.ts";
import { eatOrderMeal } from "../src/orders/eat.ts";
import { createOrder } from "../src/orders/index.ts";
import { insertAgentToken } from "../src/queries/insert-agent-token.ts";
import { assertionHeader, signAccessToken } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const now = "2026-01-01T12:00:00.000Z";
test("meal actions scale labels, replay before revisions and roll back rejected writes", async (context) => {
  const { database, admin, member, setNow } = await twoUsers(
    context,
    "fallback",
  );
  setNow(now);
  let sequence = 0;
  const make = async (
    person = admin,
    quantity = 3,
    delivery_date = "2026-01-01",
    answered = true,
  ) => {
    const order = writeTransaction(database, (scope) =>
      createOrder(
        scope,
        person.user,
        {
          service: `Example service ${sequence++}`,
          delivery_date,
          status: "scheduled",
          meals: [{ name: "Example bowl", chef: "Example chef", quantity }],
        },
        mealNutritionKinds,
        now,
      ),
    );
    const [question] = (await (await person.request("/api/questions")).json())
      .questions;
    if (answered)
      assert.equal(
        (
          await person.request("/api/questions/answer", {
            method: "POST",
            body: JSON.stringify({
              id: question.id,
              answer: {
                kcal: 600,
                protein_g: 35,
                carbs_g: 60,
                fat_g: 20,
                source: "Example label",
              },
            }),
          })
        ).status,
        200,
      );
    return database
      .prepare("SELECT id FROM order_meals WHERE user_id = ? AND order_id = ?")
      .get(person.user.id, order.id) as { id: number };
  };
  const state = () =>
    ["intake_entries", "order_meals", "meal_actions", "orders", "days"].map(
      (table) => database.prepare(`SELECT * FROM ${table}`).all(),
    );
  const action = (meal_id: number, mutation_id = "example-mutation") => ({
    meal_id,
    mutation_id,
    revision: 1,
    action: "ate_three_quarters" as const,
  });
  const send = (input: unknown, person = admin) =>
    person.request("/api/meals/eat", {
      method: "POST",
      body: JSON.stringify(input),
    });
  const reject = async (
    input: unknown,
    code: string,
    person = admin,
    status = 409,
  ) => {
    const before = state();
    const response = await send(input, person);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: { code } });
    assert.deepEqual(state(), before);
  };
  const meal = await make();
  for (const invalid of [
    {},
    { ...action(meal.id), mutation_id: " " },
    { ...action(meal.id), action: "skip" },
    { ...action(meal.id), extra: true },
  ])
    await reject(invalid, "invalid_request", admin, 400);
  const first = await send(action(meal.id));
  assert.equal(first.status, 200);
  const result = await first.json();
  assert.deepEqual(result.meal, { id: meal.id, quantity: 2, revision: 2 });
  for (const [key, value] of Object.entries({
    kcal: 450,
    protein_g: 26.25,
    provenance: "label",
    source: "Example label",
    client_id: "example-mutation",
    servings: 0.75,
    eaten_at: now,
    fiber_g: null,
  }))
    assert.equal(result.entry[key], value, key);
  assert.equal(
    (
      database
        .prepare(
          "SELECT delivered_at FROM orders WHERE id = (SELECT order_id FROM order_meals WHERE id = ?)",
        )
        .get(meal.id) as { delivered_at: null }
    ).delivered_at,
    null,
  );
  database.prepare("UPDATE days SET signed_off_at = ?").run(now);
  const beforeReplay = state();
  assert.deepEqual(await (await send(action(meal.id))).json(), result);
  assert.deepEqual(state(), beforeReplay);
  const legacy = structuredClone(result);
  delete legacy.entry.slot_template_id;
  delete legacy.entry.slot_position;
  const receipt = database.prepare(
    "UPDATE meal_actions SET result = ? WHERE user_id = ? AND mutation_id = ?",
  );
  receipt.run(JSON.stringify(legacy), admin.user.id, "example-mutation");
  assert.deepEqual(await (await send(action(meal.id))).json(), legacy);
  receipt.run(JSON.stringify(result), admin.user.id, "example-mutation");
  await reject(action(meal.id, "stale-mutation"), "stale_revision");
  await reject({ ...action(meal.id), action: "ate" }, "mutation_conflict");
  await reject(action(meal.id), "meal_not_found", member, 404);
  const other = await make(member);
  const whole = await send({ ...action(other.id), action: "ate" }, member);
  assert.equal(whole.status, 200);
  assert.equal((await whole.json()).entry.kcal, 600);
  await reject(action(other.id), "mutation_conflict");
  for (const [quantity, date, code] of [
    [0, "2026-01-01", "meal_out_of_stock"],
    [1, "2026-01-02", "meal_not_due"],
    [1, "2026-01-01", "meal_nutrition_pending"],
  ] as const) {
    const blocked = await make(admin, quantity, date, false);
    await reject(action(blocked.id, code), code);
    database.prepare("DELETE FROM questions WHERE status = 'open'").run();
    if (code === "meal_nutrition_pending")
      await reject(action(blocked.id, "missing"), "meal_nutrition_missing");
  }
  const collision = await make();
  await reject(action(collision.id), "mutation_conflict");
  const existing = await admin.request("/api/intake", {
    method: "POST",
    body: JSON.stringify({
      client_id: "intake-collision",
      name: "Example snack",
      kcal: 77,
    }),
  });
  assert.equal(existing.status, 201);
  await reject(action(collision.id, "intake-collision"), "mutation_conflict");
  const beforeFailure = state();
  database.exec(
    "CREATE TRIGGER fail_meal_action BEFORE INSERT ON meal_actions BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
  );
  assert.throws(
    () =>
      writeTransaction(database, (scope) =>
        eatOrderMeal(scope, admin.user, action(collision.id, "rollback"), now),
      ),
    /injected failure/,
  );
  assert.deepEqual(state(), beforeFailure);
  database.exec("DROP TRIGGER fail_meal_action");
  database
    .prepare("DELETE FROM intake_entries WHERE id = ? AND user_id = ?")
    .run(result.entry.id, admin.user.id);
  const afterDelete = state();
  assert.deepEqual(await (await send(action(meal.id))).json(), result);
  assert.deepEqual(state(), afterDelete);
});

test("MCP advertises the meal action with object input fields", async (context) => {
  const { app, database, admin } = await twoUsers(context, "access");
  insertAgentToken(database, {
    client_id: "example-meal-agent",
    user_id: admin.user.id,
    name: "Example agent",
    created_at: now,
  });
  const token = await signAccessToken({
    sub: "",
    common_name: "example-meal-agent",
  });
  const client = new Client({ name: "example", version: "1" });
  context.after(() => client.close());
  const transport = new StreamableHTTPClientTransport(
    new URL("http://localhost/mcp"),
    {
      fetch: async (url, init) => app.request(url.toString(), init),
      requestInit: { headers: assertionHeader(token) },
    },
  );
  await client.connect(transport);
  const tool = (await client.listTools()).tools.find(
    (tool) => tool.name === "eat_meal",
  );
  assert.ok(tool);
  assert.equal(tool.inputSchema.type, "object");
  assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), [
    "action",
    "meal_id",
    "mutation_id",
    "revision",
  ]);
  await transport.terminateSession();
});
