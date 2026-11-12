import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { mcpSession } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { orderMeal } from "./support/order-meals.ts";
import { json, pantryHarness } from "./support/pantry-fake.ts";
import { planDay } from "./support/plan-day.ts";

async function setup(context: TestContext) {
  const harness = await pantryHarness(context);
  const { database, admin } = harness;
  const count = () =>
    database.prepare("SELECT count(*) FROM pantry_requests").pluck().get();
  // Binds every food the owner has, so order nutrition foods are bound too.
  const bindAll = () =>
    database
      .prepare(
        "INSERT OR IGNORE INTO pantry_bindings SELECT user_id, (SELECT generation FROM pantry_connection), 'food', id, 7, 2, 0.5, 'valid', 'token' FROM foods WHERE user_id = ?",
      )
      .run(admin.user.id);
  const addFood = (userId: number) =>
    Number(
      database
        .prepare(
          "INSERT INTO foods (user_id, name, kcal, provenance) VALUES (?, 'Synthetic beans', 100, 'label')",
        )
        .run(userId).lastInsertRowid,
    );
  return { ...harness, count, bindAll, addFood, send: json };
}

const pending = (request_id: string, quantity: number) => ({
  request_id,
  state: "pending",
  reason: null,
  product_id: 7,
  stock_unit_id: 2,
  quantity,
  edited_servings: null,
});
const reasonOnly = (reason: string) => ({
  request_id: null,
  state: null,
  reason,
  product_id: null,
  stock_unit_id: null,
  quantity: null,
  edited_servings: null,
});

test("food logs record stock over HTTP and MCP, and edits and deletes report it", async (context) => {
  const harness = await setup(context);
  const { admin, member, send, count, kicks } = harness;
  const food = harness.addFood(admin.user.id);
  harness.bindAll();
  const unbound = harness.addFood(admin.user.id);
  const log = { client_id: "bound", food_id: food, servings: 2 };
  const logged = await send(admin, "/api/intake", log);
  assert.equal(logged.status, 201);
  const request = logged.body.stock.request_id;
  assert.deepEqual(logged.body.stock, pending(request, 1));
  assert.deepEqual(
    (await send(admin, "/api/intake", log)).body.stock,
    pending(request, 1),
  );
  assert.deepEqual([count(), kicks.length], [1, 1]);
  const path = `/api/intake/${logged.body.entry.id}`;
  assert.equal((await send(member, path, {}, "DELETE")).status, 404);
  const edited = await send(admin, path, { servings: 3 }, "PATCH");
  assert.deepEqual(edited.body.stock, pending(request, 1.5));
  const deleted = await send(admin, path, {}, "DELETE");
  assert.deepEqual(deleted.body.stock, {
    ...pending(request, 1.5),
    state: "cancelled",
  });

  const client = await mcpSession(context, harness, admin.user.id);
  const call = async (args: Record<string, unknown>) =>
    (await client.callTool({ name: "log_food", arguments: args }))
      .structuredContent as { stock?: unknown };
  assert.deepEqual(
    (await call({ client_id: "unbound", food_id: unbound, servings: 1 })).stock,
    reasonOnly("no_binding"),
  );
  assert.equal(
    "stock" in (await call({ client_id: "ad-hoc", name: "Snack", kcal: 90 })),
    false,
  );
  const theirs = harness.addFood(member.user.id);
  const other = await send(member, "/api/intake", {
    client_id: "other",
    food_id: theirs,
    servings: 1,
  });
  assert.deepEqual(other.body.stock, reasonOnly("not_owner"));
  assert.equal(count(), 1);
});

test("meal actions consume planned grocery food only and replay the current stock", async (context) => {
  const harness = await setup(context);
  const { admin, database, send, count } = harness;
  const soup = await planDay(database, admin, "UTC", [
    { name: "Breakfast", start_minute: 0, end_minute: 600, share: 40 },
    { name: "Lunch", start_minute: 600, end_minute: 900, share: 30 },
    { name: "Dinner", start_minute: 900, end_minute: 1440, share: 30 },
  ]);
  const { body: saved } = await send(admin, "/api/regular-meals", {
    action: "create",
    name: "Synthetic bowl",
    kcal: 500,
    protein_g: 30,
    baseline: "estimate",
  });
  harness.bindAll();
  const regular = await send(admin, "/api/regular-meals/log", {
    id: saved.meal.id,
    client_id: "regular",
    eaten_at: "2026-01-01T00:00:00.000Z",
  });
  assert.deepEqual(
    regular.body.stock,
    pending(regular.body.stock.request_id, 0.5),
  );

  const plan = async (
    position: number,
    reference: object = { food_id: soup },
  ) =>
    (await send(admin, "/api/plan/slot", { position, ...reference })).body.item;
  const item = await plan(0);
  const act = {
    item_id: item.id,
    revision: item.revision,
    action: "ate_three_quarters",
    mutation_id: "planned",
  };
  const acted = await send(admin, "/api/plan/items/action", act);
  const request = acted.body.stock.request_id;
  assert.deepEqual(acted.body.stock, pending(request, 0.375));
  // A replay reads the request as it is now, so a later shortage shows without another consume.
  database
    .prepare(
      "UPDATE pantry_requests SET state = 'rejected', reason = 'http' WHERE id = ?",
    )
    .run(request);
  const rejected = {
    ...pending(request, 0.375),
    state: "rejected",
    reason: "http",
  };
  assert.deepEqual(
    (await send(admin, "/api/plan/items/action", act)).body.stock,
    rejected,
  );
  await send(admin, `/api/intake/${acted.body.entry.id}`, {}, "DELETE");
  assert.deepEqual(
    (await send(admin, "/api/plan/items/action", act)).body.stock,
    rejected,
  );
  assert.equal(count(), 2);

  const skipped = await plan(1);
  const skip = await send(admin, "/api/plan/items/action", {
    item_id: skipped.id,
    revision: skipped.revision,
    action: "skip",
    mutation_id: "skip",
  });
  assert.equal("stock" in skip.body, false);
  // A bound nutrition food still draws on Tare's order stock, never the pantry.
  const meal = await orderMeal(
    database,
    admin,
    "2026-01-01",
    1,
    "2026-01-01T00:00:00.000Z",
  );
  harness.bindAll();
  const ordered = await plan(2, { meal_id: meal });
  const eaten = await send(admin, "/api/plan/items/action", {
    item_id: ordered.id,
    revision: ordered.revision,
    action: "ate",
    mutation_id: "order",
  });
  assert.equal(eaten.body.meal.quantity, 0);
  assert.equal("stock" in eaten.body, false);
  assert.equal(count(), 2);
});
