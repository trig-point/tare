import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { loadConfig } from "../src/config.ts";
import { writeTransaction } from "../src/db.ts";
import { ownedFoodValues } from "../src/foods/create.ts";
import { createGroceryService } from "../src/grocery/flow.ts";
import { groceryOperations } from "../src/grocery/operations.ts";
import * as store from "../src/grocery/store.ts";
import { createGroceryClient } from "../src/grocy/grocery.ts";
import {
  grocyLocators,
  guardPantryResponse,
  isGroceryOperation,
} from "../src/pantry/egress.ts";
import { createPantryService } from "../src/pantry/service.ts";
import {
  accessConfig,
  assertionHeader,
  mcpSession,
  signAccessToken,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { grocy, grocyFetch, json } from "./support/pantry-fake.ts";
import { disabledStock } from "./support/stock.ts";
import { twoUsers } from "./support/two-users.ts";

const linked = { ...grocy, publicUrl: "http://grocy/" };
const clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };
const rice = {
  food: {
    create: {
      name: "Example jasmine rice",
      serving_size: 45,
      serving_unit: "g",
      kcal: 160,
      carbs_g: 36,
      provenance: "label",
      source: "Example package label",
    },
  },
  unit: { create: { name: "Serving", name_plural: "Servings" } },
  location: { create: { name: "Pantry" } },
  product: { create: { name: "Example rice" } },
  barcode: { code: "0001234567890", amount: 1 },
  amount: 2.5,
  purchased_date: "2026-01-01",
  best_before_date: "never",
  quantity_per_serving: 1,
};

/** Grocy rows answer exact `column=value` filters and grow on POST; every method is recorded. */
async function setup(context: TestContext) {
  const tables: Record<string, Record<string, unknown>[]> = {
    quantity_units: [],
    locations: [],
    products: [],
    product_barcodes: [],
    stock_log: [],
  };
  const routes = Object.fromEntries(
    Object.keys(tables).flatMap((table) => [
      [
        `/objects/${table}`,
        ({ search, body }: { search: URLSearchParams; body: unknown }) =>
          body
            ? {
                created_object_id: String(
                  (tables[table] ?? []).push({
                    active: 1,
                    ...(body as object),
                    id: (tables[table]?.length ?? 0) + 10,
                  }) + 9,
                ),
              }
            : (tables[table] ?? []).filter((row) =>
                search.getAll("query[]").every((filter) => {
                  const [column, value] = filter.split(/[=>]/);
                  return filter.includes(">")
                    ? Number(row[column ?? ""]) > Number(value)
                    : String(row[column ?? ""]) === value;
                }),
              ),
      ],
      [
        `/objects/${table}/:id`,
        ({ id }: { id: string }) =>
          tables[table]?.find((row) => row.id === Number(id)) ??
          Response.json({}, { status: 404 }),
      ],
    ]),
  );
  const grocyState = { version: "4.7.1", loseAdd: false, refreshes: 0 };
  const fake = grocyFetch({
    ...routes,
    "/system/info": () => ({ grocy_version: { Version: grocyState.version } }),
    "/stock/products/:id/add": ({
      id,
      body,
    }: {
      id: string;
      body: Record<string, unknown>;
    }) => {
      const row = {
        ...body,
        id: (tables.stock_log?.length ?? 0) + 42,
        product_id: Number(id),
        transaction_id: String((tables.stock_log?.length ?? 0) + 9000),
        undone: 0,
      };
      tables.stock_log?.push(row);
      if (grocyState.loseAdd) throw new Error("Response lost");
      return [row];
    },
    "/stock/transactions/:id": ({ id }: { id: string }) =>
      tables.stock_log?.filter((row) => row.transaction_id === id),
  });
  const methods: string[] = [];
  const wired: Record<string, object> = {};
  // The owner exists only after the app does, so services are wired in afterwards.
  const late = (name: string) =>
    new Proxy({} as never, {
      get: (_target, key) => Reflect.get(wired[name] ?? {}, key),
    });
  const harness = await twoUsers(context, "access", {
    pantry: late("pantry"),
    stock: disabledStock,
    grocery: late("grocery"),
    config: {
      ...loadConfig({ DATABASE_URL: ":memory:" }),
      ...accessConfig,
      grocy: linked,
    },
  });
  const { database, admin } = harness;
  wired.pantry = createPantryService({
    database,
    config: linked,
    ownerId: admin.user.id,
    clock,
  });
  wired.grocery = createGroceryService({
    database,
    config: grocy,
    ownerId: admin.user.id,
    clock,
    refresh: async () => grocyState.refreshes++,
    client: createGroceryClient({
      config: grocy,
      ownerId: admin.user.id,
      fetch: (url, init) => {
        methods.push(init?.method ?? "GET");
        return fake.fetch(url, init);
      },
    }),
  });
  const changes = () =>
    database.prepare("SELECT total_changes() AS count").get();
  return { ...harness, tables, methods, changes, fake, grocyState, wired };
}

const reuse = {
  ...rice,
  unit: { id: 4 },
  location: { id: 3 },
  product: { id: 1 },
};
/** The rice example already in Grocy: unit 4, location 3, product 1 and its barcode; unit 5 is unused. */
function seed(tables: Record<string, Record<string, unknown>[]>) {
  tables.quantity_units?.push(
    { id: 4, name: "Serving", name_plural: "Servings", active: 1 },
    { id: 5, name: "Gram", name_plural: "Grams", active: 1 },
  );
  tables.locations?.push({ id: 3, name: "Pantry", active: 1 });
  tables.products?.push({
    id: 1,
    name: "Example rice",
    active: 1,
    location_id: 3,
    qu_id_stock: 4,
    qu_id_purchase: 4,
    qu_id_consume: 4,
    qu_id_price: 4,
    default_best_before_days: -1,
    min_stock_amount: 0,
    enable_tare_weight_handling: 0,
  });
  tables.product_barcodes?.push({
    id: 8,
    product_id: 1,
    barcode: "0001234567890",
    qu_id: 4,
    amount: 1,
  });
}

test("propose_grocery plans from empty Grocy and from reuse with no write, and blocks collisions", async (context) => {
  const { admin, tables, methods, changes } = await setup(context);
  const before = changes();
  const propose = (body: unknown) =>
    json(admin, "/api/pantry/groceries/proposal", body);
  const empty = await propose(rice);
  assert.equal(empty.status, 200);
  assert.equal(empty.body.outcome, "plan");
  assert.deepEqual(empty.body.steps, [
    "unit",
    "location",
    "product",
    "barcode",
    "stock_add",
  ]);
  assert.deepEqual(empty.body.food, {
    name: "Example jasmine rice",
    serving_size: 45,
    serving_unit: "g",
    kcal: 160,
  });
  assert.deepEqual(empty.body.plan.overlaps, []);
  const unsourced = { ...rice.food.create, source: undefined };
  assert.equal(
    (await propose({ ...rice, food: { create: unsourced } })).body.error.code,
    "label_source_required",
  );
  const spaced = { create: { name: "Serving", name_plural: "Servings " } };
  assert.equal((await propose({ ...rice, unit: spaced })).status, 400);

  seed(tables);
  const padded = { ...rice, barcode: { code: "001234567890", amount: 1 } };
  const blocked = await propose(padded);
  assert.equal(blocked.body.outcome, "blocked");
  assert.equal(blocked.body.plan, null);
  assert.deepEqual(blocked.body.issues, [
    { code: "unit_exists", id: 4 },
    { code: "location_exists", id: 3 },
    { code: "product_exists", id: 1 },
    { code: "barcode_taken", id: 1 },
  ]);
  const reused = await propose(reuse);
  assert.equal(reused.body.outcome, "plan");
  assert.deepEqual(reused.body.steps, ["stock_add"]);
  assert.equal(reused.body.plan.barcode, null);
  const product = tables.products?.[0] as Record<string, unknown>;
  for (const [body, change, code, id] of [
    [
      { barcode: { code: "0001234567890", amount: 6 } },
      {},
      "barcode_differs",
      1,
    ],
    [{ barcode: null, product: { id: 99 } }, {}, "product_missing", 99],
    [{ unit: { id: 5 } }, {}, "unit_mismatch", 4],
    [{}, { enable_tare_weight_handling: 1 }, "product_tare", 1],
    [{}, { active: 0 }, "product_inactive", 1],
  ] as const) {
    Object.assign(product, change);
    const { issues } = (await propose({ ...reuse, ...body })).body;
    assert.deepEqual(issues, [{ code, id }]);
  }

  assert.deepEqual(changes(), before);
  assert.equal(methods.includes("POST"), false);
});

test("grocery reads list overlaps, bindings and live purchase candidates", async (context) => {
  const { admin, database, tables } = await setup(context);
  seed(tables);
  const propose = (body: unknown) =>
    json(admin, "/api/pantry/groceries/proposal", body);
  const open = async (body: unknown, mutationId: string) => {
    const { plan, steps } = (await propose(body)).body;
    return writeTransaction(database, (scope) =>
      store.insertGroceryRequest(
        scope,
        {
          ownerId: admin.user.id,
          userId: admin.user.id,
          mutationId,
          plan: JSON.stringify(plan),
          restoreNonce: plan.restore_nonce,
          steps,
          food: { values: ownedFoodValues(plan.food.create) },
        },
        clock,
      ),
    ).request;
  };
  const mutationId = "00000000-0000-4000-8000-000000000001";
  const request = await open(reuse, mutationId);
  const claim = store.claimGroceryStep(
    database,
    { request_id: request.id, number: 1 },
    clock,
    { product_id: 1, stock_log_max: 41 },
  );
  assert.ok(claim);
  store.finalizeGroceryStep(
    database,
    claim,
    { status: "uncertain", reason: "timeout" },
    clock,
  );
  tables.stock_log?.push(
    ...[41, 42, 43].map((id) => ({
      id,
      product_id: 1,
      amount: 2.5,
      best_before_date: "2999-12-31",
      purchased_date: "2026-01-01",
      transaction_id: `tx${id}`,
      transaction_type: "purchase",
      location_id: 3,
      undone: id === 43 ? 1 : 0,
    })),
  );

  const status = () =>
    json(admin, "/api/pantry/groceries/status", { mutation_id: mutationId });
  const uncertain = (await status()).body;
  assert.equal(uncertain.request.steps[0].state, "uncertain");
  assert.deepEqual(uncertain.request.candidates, {
    transactions: ["tx42"],
    complete: true,
  });
  assert.deepEqual(uncertain.open, [
    { mutation_id: mutationId, state: "open" },
  ]);
  assert.deepEqual((await propose(reuse)).body.plan.overlaps, [mutationId]);
  const brown = (name: string, code: string) => ({
    ...reuse,
    product: { create: { name } },
    barcode: { code, amount: 1 },
  });
  const padded = "00000000-0000-4000-8000-000000000002";
  await open(brown("Brown rice", "0098765432109"), padded);
  assert.deepEqual(
    (await propose(brown("Wild rice", "098765432109"))).body.plan.overlaps,
    [padded],
  );

  const bind = database.prepare(
    "INSERT OR REPLACE INTO pantry_bindings VALUES (?, 1, 'food', ?, ?, 4, 1, 'valid', ?)",
  );
  bind.run(admin.user.id, request.food_id, 1, randomUUID());
  const owned = { ...reuse, food: { food_id: request.food_id } };
  const bound = (await propose(owned)).body.plan;
  assert.equal(bound.binding_seen.status, "valid");
  assert.equal(bound.food_seen, request.food_fingerprint);
  bind.run(admin.user.id, request.food_id, 7, randomUUID());
  assert.deepEqual((await propose(owned)).body.issues, [
    { code: "food_bound", id: 7 },
  ]);

  database.prepare("UPDATE pantry_connection SET reset_required = 1").run();
  assert.equal((await status()).body.request.candidates, null);
  const unknown = { mutation_id: "00000000-0000-4000-8000-000000000009" };
  assert.equal(
    (await json(admin, "/api/pantry/groceries/status", unknown)).status,
    404,
  );
});

test("grocery responses withhold the private Grocy address while the public link stays", async (context) => {
  assert.deepEqual(grocyLocators("http://grocy:9283/api"), [
    "http://grocy:9283",
    "//grocy:9283",
    "//grocy",
    "grocy:9283",
  ]);
  const frame = `event: message\ndata: ${JSON.stringify({ text: "HTTP://10.0.0.5:9283/api" })}\n\n`;
  const sse = await guardPantryResponse(
    new Response(frame, { headers: { "content-type": "text/event-stream" } }),
    "invented-secret",
    grocyLocators("http://10.0.0.5:9283/api"),
  );
  assert.equal(await sse.text(), "");

  for (const operation of groceryOperations)
    assert.ok(isGroceryOperation(operation.name), operation.name);
  const { admin, app, database } = await setup(context);
  const copied = { ...rice, product: { create: { name: "http://grocy/api" } } };
  const http = await admin.request("/api/pantry/groceries/proposal", {
    method: "POST",
    body: JSON.stringify(copied),
  });
  assert.equal(http.status, 503);
  assert.deepEqual(await http.json(), {
    error: { code: "pantry_response_withheld" },
  });
  const plain = await json(admin, "/api/pantry/groceries/proposal", rice);
  assert.equal(plain.body.outcome, "plan");
  assert.equal(
    (await json(admin, "/api/pantry/link")).body.url,
    "http://grocy/",
  );

  await mcpSession(context, { app, database }, admin.user.id);
  const headers = {
    ...assertionHeader(
      await signAccessToken({ sub: "", common_name: "example-agent" }),
    ),
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  const send = (body: unknown, session?: string) =>
    app.request("/mcp", {
      method: "POST",
      headers: {
        ...headers,
        ...(session ? { "mcp-session-id": session } : {}),
      },
      body: JSON.stringify(body),
    });
  const initialized = await send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "synthetic", version: "1" },
    },
  });
  const session = initialized.headers.get("mcp-session-id") ?? "";
  await initialized.text();
  const call = (name: string, args: unknown, id: number) => ({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const read = await send(call("read_grocery", {}, 2), session);
  assert.match(await read.text(), /restore_nonce/);
  for (const body of [
    call("propose_grocery", copied, 3),
    [call("whoami", {}, 4), call("propose_grocery", copied, 5)],
  ])
    assert.equal(
      (await (await send(body, session)).text()).includes("//grocy"),
      false,
    );
});

const mutation = (digit: number) =>
  `00000000-0000-4000-8000-00000000000${digit}`;
async function runner(context: TestContext) {
  const harness = await setup(context);
  const call = (path: string) => (body: unknown) =>
    json(harness.admin, `/api/pantry/groceries${path}`, body);
  const posts = () =>
    harness.methods.filter((method) => method === "POST").length;
  const binding = () =>
    harness.database
      .prepare(
        "SELECT product_id, stock_unit_id, change_token FROM pantry_bindings",
      )
      .get() as { product_id: number; change_token: string } | undefined;
  return {
    ...harness,
    propose: call("/proposal"),
    execute: call(""),
    status: call("/status"),
    adopt: call("/adopt"),
    abandon: call("/abandon"),
    posts,
    binding,
  };
}

test("execute_grocery sets up the rice plan once from empty Grocy and from reuse, and replays", async (context) => {
  const { propose, execute, member, tables, posts, binding, grocyState } =
    await runner(context);
  const { plan } = (await propose(rice)).body;
  const first = await execute({ mutation_id: mutation(1), plan });
  assert.equal(first.body.request.state, "completed");
  assert.equal(posts(), 5);
  assert.equal(tables.products?.[0]?.default_best_before_days, -1);
  assert.deepEqual(
    [tables.stock_log?.[0]?.amount, tables.stock_log?.[0]?.best_before_date],
    [2.5, "2999-12-31"],
  );
  assert.equal(binding()?.product_id, 10);
  assert.equal(grocyState.refreshes, 1);
  const replayed = await execute({ mutation_id: mutation(1), plan });
  assert.deepEqual(replayed.body.request, first.body.request);
  assert.equal(posts(), 5);
  const changed = { ...plan, amount: 3 };
  assert.equal(
    (await execute({ mutation_id: mutation(1), plan: changed })).body.error
      .code,
    "grocery_conflict",
  );
  const other = await json(member, "/api/pantry/groceries", {
    mutation_id: mutation(2),
    plan,
  });
  assert.equal(other.status, 403);

  const before = binding()?.change_token;
  const again = await propose({
    ...rice,
    food: { food_id: first.body.request.food_id },
    unit: { id: 10 },
    location: { id: 10 },
    product: { id: 10 },
  });
  assert.deepEqual(again.body.steps, ["stock_add"]);
  const bought = await execute({
    mutation_id: mutation(3),
    plan: again.body.plan,
  });
  assert.equal(bought.body.request.state, "completed");
  assert.equal(posts(), 6);
  assert.notEqual(binding()?.change_token, before);
});

test("a food edit during a run stops the plan before the next send", async (context) => {
  const { propose, execute, database, fake, posts } = await runner(context);
  const first = await execute({
    mutation_id: mutation(1),
    plan: (await propose(rice)).body.plan,
  });
  const foodId = first.body.request.food_id;
  const owned = {
    ...rice,
    food: { food_id: foodId },
    unit: { id: 10 },
    location: { id: 10 },
    product: { id: 10 },
  };
  const editDuring = async (path: string, mutationId: string) => {
    const { plan } = (await propose(owned)).body;
    const held = fake.hold(path);
    const running = execute({ mutation_id: mutationId, plan });
    await held.reached;
    database
      .prepare("UPDATE foods SET kcal = kcal + 1 WHERE id = ?")
      .run(foodId);
    held.release();
    return (await running).body;
  };
  const inserting = await editDuring("/objects/products/10", mutation(2));
  assert.equal(inserting.error.code, "grocery_plan_changed");
  const sending = await editDuring("/objects/stock_log", mutation(3));
  assert.equal(sending.request.stopped, "grocery_plan_changed");
  assert.equal(sending.request.state, "open");
  assert.equal(posts(), 5);
  const stored = database
    .prepare("SELECT mutation_id FROM grocery_requests ORDER BY id")
    .all();
  assert.deepEqual(stored, [
    { mutation_id: mutation(1) },
    { mutation_id: mutation(3) },
  ]);
});

test("a lost purchase response is never resent and is adopted only with a matching transaction", async (context) => {
  const {
    propose,
    execute,
    status,
    adopt,
    tables,
    posts,
    binding,
    grocyState,
  } = await runner(context);
  seed(tables);
  const { plan } = (await propose(reuse)).body;
  grocyState.loseAdd = true;
  const lost = await execute({ mutation_id: mutation(1), plan });
  assert.equal(lost.body.request.steps[0].state, "uncertain");
  grocyState.loseAdd = false;
  await execute({ mutation_id: mutation(1), plan });
  assert.equal(posts(), 1);
  const { request, restore_nonce } = (
    await status({ mutation_id: mutation(1) })
  ).body;
  assert.deepEqual(request.candidates, {
    transactions: ["9000"],
    complete: true,
  });
  tables.stock_log?.push({
    ...tables.stock_log[0],
    id: 43,
    amount: 1,
    transaction_id: "9500",
  });
  const proof = { request_mutation_id: mutation(1), number: 1, restore_nonce };
  for (const [given, code] of [
    [{ transaction_id: "9500" }, "grocery_proof_mismatch"],
    [{ transaction_id: "9999" }, "grocery_proof_mismatch"],
    [{ object_id: 1 }, "grocery_proof_ambiguous"],
  ] as const) {
    const refused = await adopt({
      ...proof,
      mutation_id: mutation(2),
      ...given,
    });
    assert.equal(refused.body.error.code, code);
  }
  const adopted = await adopt({
    ...proof,
    mutation_id: mutation(3),
    transaction_id: "9000",
  });
  assert.equal(adopted.body.request.state, "completed");
  assert.equal(binding()?.product_id, 1);
  assert.equal(grocyState.refreshes, 1);
  const replay = await adopt({
    ...proof,
    mutation_id: mutation(3),
    transaction_id: "9000",
  });
  assert.equal(replay.body.request.state, "completed");
  assert.equal(posts(), 1);
});

test("one plan runs at a time, stops on drift or an unsupported version, and shutdown drains a send", async (context) => {
  const { propose, execute, database, tables, posts, fake, grocyState, wired } =
    await runner(context);
  const { plan } = (await propose(rice)).body;
  const run = () => execute({ mutation_id: mutation(1), plan });
  let held = fake.hold("/objects/products/10");
  const first = run();
  await held.reached;
  assert.equal(
    (await execute({ mutation_id: mutation(2), plan })).body.error.code,
    "grocery_busy",
  );
  assert.equal((await run()).body.error.code, "grocery_in_progress");
  const product = tables.products?.[0] as Record<string, unknown>;
  product.enable_tare_weight_handling = 1;
  held.release();
  assert.equal((await first).body.request.stopped, "grocery_product_changed");
  assert.equal(posts(), 4);
  product.enable_tare_weight_handling = 0;
  grocyState.version = "4.8.0";
  assert.equal((await run()).body.request.stopped, "unsupported_version");
  assert.equal(posts(), 4);

  grocyState.version = "4.7.1";
  held = fake.hold("/stock/products/10/add");
  const last = run();
  await held.reached;
  const drained = (wired.grocery as { stop(): Promise<void> }).stop();
  held.release();
  await drained;
  const stored = database
    .prepare("SELECT state FROM grocery_requests WHERE mutation_id = ?")
    .get(mutation(1));
  assert.deepEqual(stored, { state: "completed" });
  assert.equal((await last).body.request.state, "completed");
  assert.equal(posts(), 5);
  assert.equal((await propose(rice)).body.error.code, "pantry_stopping");

  const before = await runner(context);
  const early = (await before.propose(rice)).body.plan;
  const reading = before.fake.hold("/objects/products/10");
  const unsent = before.execute({ mutation_id: mutation(3), plan: early });
  await reading.reached;
  const stopped = (before.wired.grocery as { stop(): Promise<void> }).stop();
  reading.release();
  await stopped;
  assert.equal((await unsent).body.request.stopped, "pantry_stopping");
  assert.equal(before.posts(), 4);
});

test("a plan from before a restore cannot start, and abandon works while reset is required", async (context) => {
  const { propose, execute, abandon, database, tables, posts, grocyState } =
    await runner(context);
  seed(tables);
  const stale = (await propose(reuse)).body.plan;
  grocyState.loseAdd = true;
  const plan = (await propose({ ...reuse, amount: 1 })).body.plan;
  await execute({ mutation_id: mutation(1), plan });
  database
    .prepare("UPDATE grocery_restore_nonce SET nonce = ?")
    .run("0".repeat(32));
  assert.equal(
    (await execute({ mutation_id: mutation(2), plan: stale })).body.error.code,
    "grocery_plan_changed",
  );
  database.prepare("UPDATE pantry_connection SET reset_required = 1").run();
  const ending = { mutation_id: mutation(3), request_mutation_id: mutation(1) };
  for (const attempt of [1, 2])
    assert.equal(
      (await abandon(ending)).body.request.state,
      "abandoned",
      `attempt ${attempt}`,
    );
  assert.equal(
    (await execute({ mutation_id: mutation(1), plan })).body.request.state,
    "abandoned",
  );
  assert.equal(posts(), 1);
});
