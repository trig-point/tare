import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { writeTransaction } from "../src/db.ts";
import {
  mealKey,
  mealNutritionKinds,
  mealNutritionState,
} from "../src/meal-nutrition/index.ts";
import { createOrder } from "../src/orders/index.ts";
import { insertAgentToken } from "../src/queries/insert-agent-token.ts";
import { selectRegularMeal } from "../src/queries/select-regular-meal.ts";
import { assertionHeader, issuedAt, signAccessToken } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const meal = {
  service: "Example meals",
  name: "Example bowl",
  chef: "Example chef",
};
const label = {
  kcal: 600,
  protein_g: 35,
  carbs_g: 60,
  fat_g: 20,
  source: "Example package",
};

test("orders ask once, store whole-meal labels and isolate owners", async (context) => {
  const { database, admin, member } = await twoUsers(context, "fallback");
  let delivery = 10;
  const order = (
    person = admin,
    identity:
      | typeof meal
      | { service: string; name: string; chef: null } = meal,
    kinds = mealNutritionKinds,
  ) =>
    writeTransaction(database, (scope) =>
      createOrder(
        scope,
        person.user,
        {
          service: identity.service,
          delivery_date: `2026-02-${delivery++}`,
          status: "scheduled",
          meals: [{ ...identity, quantity: 1 }],
        },
        kinds,
        issuedAt.toISOString(),
      ),
    );
  const state = (
    person = admin,
    identity: Parameters<typeof mealNutritionState>[2] = meal,
  ) => mealNutritionState(database, person.user.id, identity);
  const queue = async (person = admin) =>
    (await (await person.request("/api/questions")).json()).questions;
  const answer = (id: number, value: unknown = label, person = admin) =>
    person.request("/api/questions/answer", {
      method: "POST",
      body: JSON.stringify({ id, answer: value }),
    });
  assert.deepEqual(state(), { status: "unknown" });
  assert.throws(() => order(admin, meal, new Map()), /kind_not_supported/);
  assert.deepEqual(database.prepare("SELECT * FROM orders").all(), []);
  const first = order();
  assert.equal(first.delivered_at, null);
  const [question] = await queue();
  assert.equal(question.kind, "meal_nutrition");
  assert.match(question.answer_schema.description, /whole meal.*not per 100 g/);
  order();
  assert.equal(
    (await queue()).length,
    1,
    "two orders share one open nutrition question",
  );
  assert.deepEqual(state(), { status: "pending", question_id: question.id });
  order(member);
  const [foreign] = await queue(member);
  assert.equal((await answer(foreign.id)).status, 404);
  for (const invalid of [
    {},
    { ...label, source: undefined },
    { ...label, source: " " },
    { ...label, kcal: -1 },
    { ...label, provenance: "verified" },
  ])
    assert.equal((await answer(question.id, invalid)).status, 400);
  assert.equal((await queue())[0].id, question.id);
  assert.deepEqual(database.prepare("SELECT * FROM foods").all(), []);
  assert.equal((await answer(question.id)).status, 200);
  const food = database
    .prepare("SELECT * FROM foods WHERE user_id = ?")
    .get(admin.user.id) as Record<string, unknown>;
  for (const [field, expected] of Object.entries({
    ...label,
    provenance: "label",
    user_id: admin.user.id,
    service: "example meals",
    meal_name: "example bowl",
    chef: "example chef",
    meal_key: mealKey(meal),
    serving_size: 1,
    serving_unit: "meal",
    fiber_g: null,
  }))
    assert.equal(food[field], expected, field);
  assert.deepEqual(state(), { status: "known", food_id: food.id });
  order(admin, { ...meal, name: " EXAMPLE BOWL " });
  assert.deepEqual(await queue(), []);
  assert.equal((await queue(member))[0].id, foreign.id);
  assert.deepEqual(state(member), {
    status: "pending",
    question_id: foreign.id,
  });
  for (const [chef, expected] of [
    [null, "known"],
    ["Another example chef", "pending"],
    [null, "pending"],
    [null, "known"],
  ] as const) {
    const identity = { ...meal, chef };
    order(admin, identity);
    assert.equal(state(admin, identity).status, expected);
    const questions = await queue();
    assert.equal(questions.length, expected === "pending" ? 1 : 0);
    if (expected === "pending")
      assert.equal(
        (await answer(questions[0].id, { ...label, fiber_g: 5 })).status,
        200,
      );
  }
  const saved = await admin.request("/api/regular-meals", {
    method: "POST",
    body: JSON.stringify({
      action: "create",
      name: "Example cafe bowl",
      kcal: 450,
      protein_g: 20,
      baseline: "menu",
      source: "Example menu",
      restaurant: "Example cafe",
    }),
  });
  assert.equal(saved.status, 201);
  const regular = (await saved.json()).meal;
  assert.deepEqual(
    selectRegularMeal(database, { user_id: admin.user.id, id: regular.id }),
    regular,
  );
  assert.equal("meal_key" in regular, false);
});

test("an agent answers a meal label through MCP", async (context) => {
  const { app, database, admin } = await twoUsers(context, "access");
  writeTransaction(database, (scope) =>
    createOrder(
      scope,
      admin.user,
      {
        service: meal.service,
        delivery_date: "2026-02-10",
        status: "scheduled",
        meals: [{ name: meal.name, chef: meal.chef, quantity: 1 }],
      },
      mealNutritionKinds,
      issuedAt.toISOString(),
    ),
  );
  insertAgentToken(database, {
    client_id: "example-nutrition-agent",
    user_id: admin.user.id,
    name: "Example agent",
    created_at: issuedAt.toISOString(),
  });
  const token = await signAccessToken({
    sub: "",
    common_name: "example-nutrition-agent",
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
  const call = async (name: string, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return (
      result.structuredContent ??
      JSON.parse((result.content as [{ text: string }])[0].text)
    );
  };
  const [question] = (await call("list_questions")).questions;
  assert.deepEqual(
    await call("answer_question", { id: question.id, answer: label }),
    { id: question.id, status: "answered" },
  );
  assert.deepEqual((await call("list_questions")).questions, []);
  assert.equal(
    mealNutritionState(database, admin.user.id, meal).status,
    "known",
  );
  await transport.terminateSession();
});
