import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { writeTransaction } from "../src/db.ts";
import { mealNutritionKinds } from "../src/meal-nutrition/index.ts";
import { createOrder } from "../src/orders/index.ts";
import { insertAgentToken } from "../src/queries/insert-agent-token.ts";
import {
  accessConfig,
  assertionHeader,
  signAccessToken,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { grocy, json, pantryHarness } from "./support/pantry-fake.ts";
import { planDay } from "./support/plan-day.ts";
import { twoUsers } from "./support/two-users.ts";

type Harness = Awaited<ReturnType<typeof twoUsers>>;

/** Raw JSON-RPC, so a normal batch reaches the server as one request. */
async function agent(harness: Harness, person: Harness["admin"]) {
  const name = `agent-${person.user.id}`;
  insertAgentToken(harness.database, {
    client_id: name,
    user_id: person.user.id,
    name,
    created_at: "2026-01-01T00:00:00.000Z",
  });
  const headers = {
    ...assertionHeader(await signAccessToken({ sub: "", common_name: name })),
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  let session: string | null = null;
  let sequence = 0;
  const post = async (body: unknown) => {
    const response = await harness.app.request("/mcp", {
      method: "POST",
      headers: {
        ...headers,
        ...(session ? { "mcp-session-id": session } : {}),
      },
      body: JSON.stringify(body),
    });
    session ??= response.headers.get("mcp-session-id");
    return response.text();
  };
  await post({
    jsonrpc: "2.0",
    id: ++sequence,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "synthetic", version: "1" },
    },
  });
  return (names: string[]) =>
    post(
      names.map((tool) => ({
        jsonrpc: "2.0",
        id: ++sequence,
        method: "tools/call",
        params: { name: tool, arguments: {} },
      })),
    );
}

test("suggestion context is disabled without Grocy and 503 for every caller without its service", async (context) => {
  const config = {
    ...loadConfig({ DATABASE_URL: ":memory:" }),
    ...accessConfig,
  };
  const harness = await twoUsers(context, "access", { config });
  for (const person of [harness.admin, harness.member]) {
    const disabled = await json(person, "/api/pantry/suggestions");
    assert.deepEqual(
      [disabled.status, disabled.body.state, disabled.body.plan],
      [200, "disabled", null],
    );
  }
  // createApp refuses this wiring, so the shared config is changed after startup.
  Object.assign(config, { grocy });
  for (const person of [harness.admin, harness.member]) {
    const missing = await json(person, "/api/pantry/suggestions");
    assert.deepEqual(
      [missing.status, missing.body.error.code],
      [503, "pantry_unavailable"],
    );
    const batch = await (await agent(harness, person))([
      "pantry_suggestion_context",
      "whoami",
    ]);
    assert.match(batch, /pantry_unavailable/);
    assert.match(batch, new RegExp(person.credentials.username));
  }
  assert.equal(
    (await harness.app.request("/api/pantry/suggestions")).status,
    401,
  );
});

test("suggestion context combines owner candidates, budgets and caveats", async (context) => {
  const harness = await pantryHarness(context);
  const { admin, member, database } = harness;
  const soup = await planDay(database, admin, "UTC");
  const source = Number(
    database
      .prepare(
        "INSERT INTO source_foods (source, source_key, name, provenance, fetched_at) VALUES ('off', 'synthetic', 'Synthetic oats', 'label', '2026-01-01T00:00:00.000Z')",
      )
      .run().lastInsertRowid,
  );
  harness.bind("food", soup, 7);
  harness.bind("source_food", source, 8);
  writeTransaction(database, (scope) =>
    createOrder(
      scope,
      admin.user,
      {
        service: "Example",
        delivery_date: "2026-01-01",
        status: "scheduled",
        meals: [{ name: "Unanswered bowl", chef: null, quantity: 1 }],
      },
      mealNutritionKinds,
      "2026-01-01T00:00:00.000Z",
    ),
  );
  const read = async () => {
    const result = await json(admin, "/api/pantry/suggestions");
    assert.equal(result.status, 200);
    return result.body;
  };

  assert.equal((await json(member, "/api/pantry/suggestions")).status, 403);
  assert.match(
    await (await agent(harness, member))(["pantry_suggestion_context"]),
    /forbidden/,
  );
  assert.equal(harness.reads(), 0);
  const never = await read();
  assert.equal(never.state, "never_refreshed");
  assert.deepEqual(never.groceries[0].availability.reasons, [
    "unknown",
    "stale",
  ]);

  await json(admin, "/api/pantry/refresh", {});
  harness.request(soup, "pending", 1);
  const ready = await read();
  const [bound, sourced] = ready.groceries;
  assert.deepEqual(
    [
      bound.availability.adjusted,
      bound.availability.reasons,
      bound.nutrition.basis,
      bound.action,
    ],
    [9, [], { servings: 1 }, { kind: "plan_food", food_id: soup }],
  );
  assert.deepEqual(
    [sourced.availability.reasons, sourced.action],
    [["short"], { kind: "log_source_food", source_food_id: source }],
  );
  assert.deepEqual(
    ready.unbound_stock.map((row: { product_id: number }) => row.product_id),
    [9, 10],
  );
  assert.deepEqual(
    [
      ready.meals[0].nutrition_state.status,
      ready.meals[0].nutrition.numbers.kcal,
      ready.meals[0].action.kind,
    ],
    ["pending", null, "plan_meal"],
  );
  assert.deepEqual(
    [
      ready.plan.budgets.status,
      ready.recipes.deducts_stock,
      ready.ingredient_deduction_automatic,
    ],
    ["ready", false, false],
  );
  const owner = await agent(harness, admin);
  assert.match(await owner(["pantry_suggestion_context"]), /plan_food/);

  // A binding saved after Grocy's unit changed but before the next refresh.
  harness.bind("food", soup, 7, 3);
  const [mismatched] = (await read()).groceries;
  assert.deepEqual(
    [
      mismatched.stock_unit_id,
      mismatched.availability.stock_unit_id,
      mismatched.availability.raw,
      mismatched.availability.needed,
      mismatched.availability.unit_mismatch,
    ],
    [3, 2, 10, null, true],
  );

  harness.egress.apiKey = "Example soup";
  const withheld = await json(admin, "/api/pantry/suggestions");
  assert.deepEqual(
    [withheld.status, withheld.body.error.code],
    [503, "pantry_response_withheld"],
  );
  assert.equal(await owner(["pantry_suggestion_context"]), "");
});
