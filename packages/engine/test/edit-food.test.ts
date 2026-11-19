import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { upsertSourceFood } from "../src/queries/upsert-source-food.ts";
import { mcpSession } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const rice = {
  mutation_id: "6f1c2a4e-8b3d-4c5e-9f10-2a3b4c5d6e7f",
  name: "Example jasmine rice",
  serving_size: 1,
  serving_unit: "cup",
  kcal: 160,
  carbs_g: 36,
  provenance: "label",
  source: "Example package label",
};

async function setup(context: TestContext) {
  const users = await twoUsers(context, "fallback");
  const send = async (
    path: string,
    body: unknown,
    method = "POST",
    person = users.admin,
  ) => {
    const response = await person.request(path, {
      method,
      body: JSON.stringify(body),
    });
    return { status: response.status, ...(await response.json()) };
  };
  const created = await send("/api/foods", rice);
  assert.equal(created.status, 201);
  const id: number = created.food.id;
  return {
    ...users,
    send,
    id,
    food: created.food,
    edit: (body: unknown) => send(`/api/foods/${id}`, body, "PATCH"),
  };
}

test("edit_food changes lookup and new logs while preserving past logs", async (context) => {
  const { admin, send, id, edit, food } = await setup(context);
  const log = (client_id: string) =>
    send("/api/intake", { client_id, food_id: id, servings: 1 });
  assert.equal((await log("before")).entry.kcal, 160);
  const edited = await edit({ kcal: 175, carbs_g: null });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.food, { ...food, kcal: 175, carbs_g: null });
  const found = await send("/api/foods/find", { name: rice.name });
  assert.equal(found.foods[0].nutrients.kcal.amount, 175);
  assert.equal((await log("after")).entry.kcal, 175);
  const today = await (await admin.request("/api/today")).json();
  assert.deepEqual(
    today.entries.map((entry: { kcal: number }) => entry.kcal).sort(),
    [160, 175],
  );
});

test("edit_food refuses unknown, foreign and invalid edits without changing the food", async (context) => {
  const { send, id, member, edit, food } = await setup(context);
  for (const [target, person] of [
    [id, member],
    [id + 1, undefined],
  ] as const) {
    const result = await send(
      `/api/foods/${target}`,
      { kcal: 175 },
      "PATCH",
      person,
    );
    assert.deepEqual(result, {
      status: 404,
      error: { code: "food_not_found" },
    });
  }
  for (const [body, code] of [
    [{ kcal: null, carbs_g: null }, "invalid_request"],
    [{ provenance: "label", source: null }, "label_source_required"],
    [{}, "invalid_request"],
    [{ serving_size: 2 }, "serving_basis_not_editable"],
    [{ serving_unit: "g" }, "serving_basis_not_editable"],
  ] as const) {
    const result = await edit(body);
    assert.equal(result.status, 400);
    assert.equal(result.error.code, code);
  }
  assert.deepEqual((await send("/api/foods", rice)).food, food);
});

test("edit_food refuses active and archived regular meals", async (context) => {
  const { send } = await setup(context);
  const meal = await send("/api/regular-meals", {
    action: "create",
    name: "Example meal",
    kcal: 100,
    protein_g: 10,
    baseline: "estimate",
  });
  assert.equal(meal.status, 201);
  const editMeal = async (issue: string) => {
    const result = await send(
      `/api/foods/${meal.meal.id}`,
      { kcal: 175 },
      "PATCH",
    );
    assert.deepEqual(result, {
      status: 409,
      error: {
        code: "food_is_regular_meal",
        issues: [issue],
      },
    });
  };
  await editMeal(
    "This food belongs to a regular meal; correct it with save_regular_meal.",
  );
  assert.equal(
    (await send("/api/regular-meals", { action: "delete", id: meal.meal.id }))
      .status,
    200,
  );
  await editMeal(
    "This food belongs to an archived regular meal and can't be edited.",
  );
});

test("edit_food accepts a nutrition correction after the linked catalog basis changes", async (context) => {
  const { database, send } = await setup(context);
  const catalog = {
    source: "off",
    source_key: "example",
    name: rice.name,
    brand: null,
    serving_size: rice.serving_size,
    serving_unit: rice.serving_unit,
    kcal: rice.kcal,
    protein_g: null,
    carbs_g: rice.carbs_g,
    fat_g: null,
    fiber_g: null,
    provenance: "label",
    barcode: null,
    fetched_at: "2026-01-01T00:00:00.000Z",
  } as const;
  const evidence = upsertSourceFood(database, catalog);
  assert.ok(evidence);
  const created = await send("/api/foods", {
    ...rice,
    mutation_id: "7f1c2a4e-8b3d-4c5e-9f10-2a3b4c5d6e7f",
    source_food_id: evidence.id,
  });
  assert.equal(created.status, 201);
  assert.equal(
    upsertSourceFood(database, { ...catalog, serving_size: 2 })?.id,
    evidence.id,
  );
  const edited = await send(
    `/api/foods/${created.food.id}`,
    { kcal: 175 },
    "PATCH",
  );
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.food, { ...created.food, kcal: 175 });
});

test("MCP advertises edit_food and its effect on past logs", async (context) => {
  const setup = await twoUsers(context, "access");
  const client = await mcpSession(context, setup, setup.admin.user.id);
  const { tools } = await client.listTools();
  const edit = tools.find((tool) => tool.name === "edit_food");
  assert.ok(edit?.description);
  const inputSchema = edit.inputSchema;
  assert.match(edit.description, /Create a new food for a different serving/);
  assert.equal(inputSchema.minProperties, 2);
  assert.equal(inputSchema.additionalProperties, false);
  assert.equal(inputSchema.properties?.serving_size, undefined);
  assert.equal(inputSchema.properties?.serving_unit, undefined);
  assert.deepEqual(inputSchema.properties?.id, {
    anyOf: [
      {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
      },
      { type: "string", pattern: "^0*[1-9][0-9]*$" },
    ],
  });
  const call = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args });
  const created = (await call("create_food", rice)).structuredContent;
  assert.ok(created);
  const invalid = await call("edit_food", { id: true, kcal: 175 });
  assert.equal(invalid.isError, true);
  assert.match(JSON.stringify(invalid.content), /Invalid arguments/);
  const basis = await call("edit_food", { id: "1", serving_size: 2 });
  assert.equal(basis.isError, true);
  assert.match(
    JSON.stringify(basis.content),
    /serving_basis_not_editable: Serving size and unit can't change; create a new food instead/,
  );
  assert.deepEqual((await call("create_food", rice)).structuredContent, {
    ...created,
    created: false,
  });
});
