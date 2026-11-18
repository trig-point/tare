import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { insertAgentToken } from "../src/queries/insert-agent-token.ts";
import { readBinding } from "../src/queries/pantry/read-binding.ts";
import { saveBinding } from "../src/queries/pantry/save-binding.ts";
import { saveConnection } from "../src/queries/pantry/save-connection.ts";
import { assertionHeader, signAccessToken } from "./auth-support.ts";
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
  ] as const) {
    const result = await edit(body);
    assert.equal(result.status, 400);
    assert.equal(result.error.code, code);
  }
  assert.deepEqual((await send("/api/foods", rice)).food, food);
});

test("edit_food protects regular meals and the current pantry serving basis", async (context) => {
  const { admin, database, send, edit, id, food } = await setup(context);
  const meal = await send("/api/regular-meals", {
    action: "create",
    name: "Example meal",
    kcal: 100,
    protein_g: 10,
    baseline: "estimate",
  });
  assert.equal(meal.status, 201);
  const editMeal = async () => {
    const result = await send(
      `/api/foods/${meal.meal.id}`,
      { kcal: 175 },
      "PATCH",
    );
    assert.deepEqual(result, {
      status: 409,
      error: {
        code: "food_is_regular_meal",
        issues: ["Use save_regular_meal to correct this food."],
      },
    });
  };
  await editMeal();
  assert.equal(
    (await send("/api/regular-meals", { action: "delete", id: meal.meal.id }))
      .status,
    200,
  );
  await editMeal();
  const owner = { user_id: admin.user.id, generation: 2 };
  saveConnection(database, {
    ...owner,
    url: "https://grocy.example.com",
    username: "example",
    reset_required: 0,
    fetch_started_at: null,
    last_success_at: null,
    error: null,
  });
  const reference = { ...owner, reference_kind: "food", reference_id: id };
  saveBinding(database, {
    ...reference,
    product_id: 1,
    stock_unit_id: 1,
    quantity_per_serving: 2,
    change_token: "example",
  });
  const before = readBinding(database, reference);
  assert.ok(before);
  assert.deepEqual(await edit({ serving_size: 2 }), {
    status: 409,
    error: { code: "food_bound_serving_change" },
  });
  assert.deepEqual((await edit({ kcal: 175 })).food, { ...food, kcal: 175 });
  assert.deepEqual(readBinding(database, reference), before);
});

test("MCP advertises edit_food and its effect on past logs", async (context) => {
  const { app, database, admin } = await twoUsers(context, "access");
  insertAgentToken(database, {
    client_id: "example-editor",
    user_id: admin.user.id,
    name: "Example",
    created_at: "2026-01-01T00:00:00.000Z",
  });
  const headers = new Headers({
    ...assertionHeader(
      await signAccessToken({ sub: "", common_name: "example-editor" }),
    ),
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  });
  const rpc = async (method: string, params: unknown) => {
    const response = await app.request("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    assert.equal(response.status, 200);
    const session = response.headers.get("mcp-session-id");
    if (session) headers.set("mcp-session-id", session);
    return JSON.parse((await response.text()).split("data: ").at(-1) ?? "")
      .result;
  };
  await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "Example", version: "1" },
  });
  const tools = (await rpc("tools/list", {})).tools;
  const edit = tools.find(
    (tool: { name: string }) => tool.name === "edit_food",
  );
  assert.match(edit?.description, /Past logs keep their nutrition/);
});
