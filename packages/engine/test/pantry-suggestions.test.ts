import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { loadConfig } from "../src/config.ts";
import { writeTransaction } from "../src/db.ts";
import { mealNutritionKinds } from "../src/meal-nutrition/index.ts";
import { createOrder } from "../src/orders/index.ts";
import { createPantryStock, type PantryStock } from "../src/pantry/requests.ts";
import {
  createPantryService,
  type PantryService,
} from "../src/pantry/service.ts";
import { insertAgentToken } from "../src/queries/insert-agent-token.ts";
import {
  accessConfig,
  assertionHeader,
  credentials,
  signAccessToken,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { orderMeal } from "./support/order-meals.ts";
import { planDay } from "./support/plan-day.ts";
import { twoUsers } from "./support/two-users.ts";

const grocy = {
  url: "http://grocy/api",
  apiKey: "invented-secret",
  username: credentials.username,
};
type Harness = Awaited<ReturnType<typeof twoUsers>>;
type Person = Harness["admin"];

async function json(person: Person, path: string, body?: unknown) {
  const response = await person.request(path, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

/** Raw JSON-RPC, so a normal batch reaches the server as one request. */
async function agent(harness: Harness, person: Person) {
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

test("missing pantry service answers every caller 503 and blocks only owner food planning", async (context) => {
  const config = {
    ...loadConfig({ DATABASE_URL: ":memory:" }),
    ...accessConfig,
  };
  const harness = await twoUsers(context, "access", { config });
  const { admin, member, database } = harness;
  const adminSoup = await planDay(database, admin, "UTC");
  const memberSoup = await planDay(database, member, "UTC");
  for (const person of [admin, member]) {
    const disabled = await json(person, "/api/pantry/suggestions");
    assert.deepEqual(
      [disabled.status, disabled.body.state, disabled.body.plan],
      [200, "disabled", null],
    );
  }
  // createApp refuses this wiring, so the shared config is changed after startup.
  Object.assign(config, { grocy });
  for (const person of [admin, member]) {
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
  const owned = await json(admin, "/api/plan/slot", {
    position: 0,
    food_id: adminSoup,
  });
  assert.deepEqual(
    [owned.status, owned.body.error.code],
    [503, "pantry_unavailable"],
  );
  const other = await json(member, "/api/plan/slot", {
    position: 0,
    food_id: memberSoup,
  });
  assert.deepEqual([other.status, "pantry" in other.body], [201, false]);
  const meal = await orderMeal(
    database,
    admin,
    "2026-01-01",
    1,
    "2026-01-01T00:00:00.000Z",
  );
  assert.equal(
    (await json(admin, "/api/plan/slot", { position: 1, meal_id: meal }))
      .status,
    201,
  );
});

async function setup(context: TestContext) {
  const wired: { pantry?: PantryService; stock?: PantryStock } = {};
  const late = <Value extends object>(read: () => Value | undefined) =>
    new Proxy({} as Value, {
      get: (_target, key) => Reflect.get(read() as Value, key),
    });
  const egress = { ...grocy };
  const harness = await twoUsers(context, "access", {
    pantry: late(() => wired.pantry),
    stock: late(() => wired.stock),
    config: {
      ...loadConfig({ DATABASE_URL: ":memory:" }),
      ...accessConfig,
      grocy: egress,
    },
  });
  const clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };
  let reads = 0;
  const stocked = new Map([
    [7, 10],
    [9, 3],
    [10, 5],
  ]);
  const product = (id: number) => ({
    id,
    name: `Synthetic item ${id}`,
    qu_id_stock: 2,
    enable_tare_weight_handling: 0 as const,
  });
  const ok = <Value>(value: Value) =>
    Promise.resolve({ status: "ok" as const, value });
  wired.pantry = createPantryService({
    database: harness.database,
    config: grocy,
    ownerId: harness.admin.user.id,
    clock: { now: () => clock.now() },
    client: {
      stock: () => {
        reads++;
        return ok(
          [...stocked].map(([id, amount]) => ({
            product_id: id,
            amount,
            best_before_date: null,
            product: product(id),
          })),
        );
      },
      catalog: () =>
        ok([7, 8, 9, 10].map((id) => ({ ...product(id), active: 1 as const }))),
      product: (_owner, id) =>
        ok({
          product: product(id),
          quantity_unit_stock: { id: 2, name: "can", name_plural: null },
        }),
      barcodes: () => ok([]),
      recipes: () => ok([]),
      recipePositions: () => ok([]),
      fulfillment: () => ok([]),
      units: () => ok([]),
      conversions: () => ok([]),
    },
  });
  wired.stock = createPantryStock({
    config: grocy,
    ownerId: harness.admin.user.id,
    clock,
    report: assert.fail,
  });
  return { ...harness, clock, egress, reads: () => reads };
}

test("suggestion context classifies stock against the fetch start, and planning rechecks it", async (context) => {
  const harness = await setup(context);
  const { admin, member, database, clock } = harness;
  const soup = await planDay(database, admin, "UTC");
  const source = Number(
    database
      .prepare(
        "INSERT INTO source_foods (source, source_key, name, provenance, fetched_at) VALUES ('off', 'synthetic', 'Synthetic oats', 'label', '2026-01-01T00:00:00.000Z')",
      )
      .run().lastInsertRowid,
  );
  const bind = (kind: string, id: number, product: number, unit = 2) =>
    database
      .prepare(
        "INSERT OR REPLACE INTO pantry_bindings VALUES (?, (SELECT generation FROM pantry_connection), ?, ?, ?, ?, 0.5, 'valid', ?)",
      )
      .run(admin.user.id, kind, id, product, unit, randomUUID());
  bind("food", soup, 7);
  bind("source_food", source, 8);
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

  // An old snapshot is stale against the request clock.
  clock.now = () => new Date("2025-12-31T23:00:00.000Z");
  await json(admin, "/api/pantry/refresh", {});
  assert.ok((await read()).groceries[0].availability.reasons.includes("stale"));
  const fetchedAt = "2026-01-01T00:00:00.000Z";
  clock.now = () => new Date(fetchedAt);
  await json(admin, "/api/pantry/refresh", {});

  const attempts = database.prepare(
    "INSERT INTO pantry_attempts VALUES (?, 1, ?, ?, NULL, NULL, ?, ?, ?)",
  );
  const request = (state: string, quantity: number, at?: string) => {
    const id = randomUUID();
    database
      .prepare(
        "INSERT INTO pantry_requests (id, user_id, generation, client_id, reference_kind, reference_id, product_id, stock_unit_id, quantity_per_serving, quantity, state, attempt_count, claim_token, created_at) VALUES (?, ?, 1, ?, 'food', ?, 7, 2, 0.5, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        admin.user.id,
        id,
        soup,
        quantity,
        state,
        at ? 1 : 0,
        state === "sending" ? id : null,
        fetchedAt,
      );
    if (at && state === "sending")
      attempts.run(id, id, "sending", null, at, null);
    if (at && state === "delivered")
      attempts.run(id, id, "confirmed", "[]", at, at);
    return id;
  };
  request("pending", 1);
  const after = request("sending", 2, "2026-01-01T00:00:01.000Z");
  request("sending", 4, fetchedAt);
  const delivered = request("delivered", 8, fetchedAt);
  request("delivered", 16, "2025-12-31T23:59:59.000Z");
  request("uncertain", 32);
  const ready = await read();
  const [bound, sourced] = ready.groceries;
  assert.deepEqual(bound.availability.state_amounts, {
    pending: 1,
    sending_after: 2,
    sending_before_or_equal: 4,
    delivered_after_or_equal: 8,
    uncertain: 32,
    rejected: 0,
  });
  assert.deepEqual(
    [
      bound.availability.raw,
      bound.availability.deducted,
      bound.availability.adjusted,
      bound.availability.needed,
      bound.availability.reasons,
    ],
    [10, 3, 7, 0.5, ["uncertain"]],
  );
  assert.deepEqual(bound.action, { kind: "plan_food", food_id: soup });
  assert.deepEqual(
    [
      sourced.availability.raw,
      sourced.availability.shortfall,
      sourced.availability.reasons,
      sourced.action,
    ],
    [0, 0.5, ["short"], { kind: "log_source_food", source_food_id: source }],
  );
  assert.deepEqual(
    ready.unbound_stock.map((row: { product_id: number }) => row.product_id),
    [9, 10],
  );
  assert.deepEqual(ready.meals[0].nutrition_state.status, "pending");
  assert.equal(ready.meals[0].nutrition.numbers.kcal, null);
  assert.deepEqual(
    [
      ready.plan.budgets.status,
      ready.recipes.deducts_stock,
      ready.ingredient_deduction_automatic,
    ],
    ["ready", false, false],
  );

  // A bucket with one unclassifiable row is unknown as a whole, never a partial sum.
  database
    .prepare(
      "UPDATE pantry_attempts SET started_at = 'not-a-time' WHERE request_id = ?",
    )
    .run(after);
  const untimed = (await read()).groceries[0].availability;
  assert.deepEqual(
    [
      untimed.state_amounts.sending_after,
      untimed.state_amounts.sending_before_or_equal,
      untimed.deducted,
      untimed.adjusted,
      untimed.raw,
      untimed.needed,
      untimed.reasons,
    ],
    [null, null, null, null, 10, 0.5, ["unknown", "uncertain"]],
  );
  database
    .prepare("UPDATE pantry_attempts SET started_at = ? WHERE request_id = ?")
    .run("2026-01-01T00:00:01.000Z", after);
  database
    .prepare(
      "UPDATE pantry_attempts SET finished_at = NULL WHERE request_id = ?",
    )
    .run(delivered);
  const unconfirmed = (await read()).groceries[0].availability;
  assert.deepEqual(
    [
      unconfirmed.state_amounts.delivered_after_or_equal,
      unconfirmed.deducted,
      unconfirmed.timing_unknown,
    ],
    [null, 3, true],
  );

  const plan = (body: object) => json(admin, "/api/plan/slot", body);
  const short = await plan({ position: 0, food_id: soup, servings: 20 });
  assert.deepEqual(
    [
      short.status,
      short.body.pantry.shortfall,
      short.body.pantry.reasons.at(-1),
    ],
    [201, 3, "short"],
  );
  const item = short.body.item;
  const again = await plan({
    position: 0,
    food_id: soup,
    servings: 20,
    item_id: item.id,
    revision: item.revision,
  });
  assert.deepEqual([again.status, again.body.pantry.shortfall], [200, 3]);
  assert.equal(
    database.prepare("SELECT count(*) FROM pantry_requests").pluck().get(),
    6,
  );

  // A binding saved after Grocy's unit changed but before the next refresh.
  const rice = Number(
    database
      .prepare(
        "INSERT INTO foods (user_id, name, provenance) VALUES (?, 'Synthetic rice', 'label')",
      )
      .run(admin.user.id).lastInsertRowid,
  );
  bind("food", rice, 10, 3);
  const mismatched = (await read()).groceries.find(
    (row: { reference: { reference_id: number } }) =>
      row.reference.reference_id === rice,
  );
  const expected = [2, 5, null, null, true, "valid"];
  const fields = (availability: Record<string, unknown>) =>
    [
      "stock_unit_id",
      "raw",
      "needed",
      "adjusted",
      "unit_mismatch",
      "binding_status",
    ].map((key) => availability[key]);
  assert.deepEqual(
    [mismatched.stock_unit_id, ...fields(mismatched.availability)],
    [3, ...expected],
  );
  const changed = await plan({
    position: 0,
    food_id: rice,
    item_id: item.id,
    revision: item.revision,
  });
  assert.deepEqual(fields(changed.body.pantry), expected);
  const noop = await plan({
    position: 0,
    food_id: rice,
    item_id: item.id,
    revision: changed.body.item.revision,
  });
  assert.deepEqual(
    [noop.status, ...fields(noop.body.pantry)],
    [200, ...expected],
  );

  const planned = (await plan({ position: 1, food_id: soup })).body.item;
  const act = {
    item_id: planned.id,
    revision: planned.revision,
    action: "ate_three_quarters",
    mutation_id: "suggested",
  };
  const ate = await json(admin, "/api/plan/items/action", act);
  assert.deepEqual(
    [ate.body.stock.state, ate.body.stock.quantity],
    ["pending", 0.375],
  );
  assert.equal(
    (await json(admin, "/api/plan/items/action", act)).body.stock.request_id,
    ate.body.stock.request_id,
  );
  assert.equal(
    database.prepare("SELECT count(*) FROM pantry_requests").pluck().get(),
    7,
  );

  harness.egress.apiKey = "Synthetic rice";
  for (const response of [
    await json(admin, "/api/pantry/suggestions"),
    await plan({
      position: 0,
      food_id: rice,
      item_id: item.id,
      revision: noop.body.item.revision,
    }),
  ])
    assert.deepEqual(
      [response.status, response.body.error.code],
      [503, "pantry_response_withheld"],
    );
});
