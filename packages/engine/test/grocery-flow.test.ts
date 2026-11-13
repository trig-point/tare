import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { loadConfig } from "../src/config.ts";
import { writeTransaction } from "../src/db.ts";
import { createGroceryService } from "../src/grocery/flow.ts";
import * as store from "../src/grocery/store.ts";
import { createGroceryClient } from "../src/grocy/grocery.ts";
import { numbersFrom } from "../src/logging/schemas.ts";
import { grocyLocators, guardPantryResponse } from "../src/pantry/egress.ts";
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

/** Grocy rows answer exact `column=value` filters; every method is recorded. */
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
        ({ search }: { search: URLSearchParams }) =>
          (tables[table] ?? []).filter((row) =>
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
  const fake = grocyFetch({
    ...routes,
    "/system/info": { grocy_version: { Version: "4.7.1" } },
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
  return { ...harness, tables, methods, changes };
}

test("propose_grocery plans from empty Grocy and from reuse with no write, and blocks collisions", async (context) => {
  const { admin, tables, methods, changes } = await setup(context);
  const before = changes();
  const empty = await json(admin, "/api/pantry/groceries/proposal", rice);
  assert.equal(empty.status, 200);
  assert.equal(empty.body.outcome, "plan");
  assert.deepEqual(empty.body.steps, [
    "unit",
    "location",
    "product",
    "barcode",
    "stock_add",
  ]);
  assert.equal(empty.body.plan.food.create.protein_g, null);
  assert.deepEqual(empty.body.food, {
    name: "Example jasmine rice",
    serving_size: 45,
    serving_unit: "g",
    kcal: 160,
  });
  assert.deepEqual(empty.body.plan.overlaps, []);

  tables.quantity_units?.push({
    id: 4,
    name: "Serving",
    name_plural: "Servings",
    active: 1,
  });
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
  const blocked = await json(admin, "/api/pantry/groceries/proposal", rice);
  assert.equal(blocked.body.outcome, "blocked");
  assert.equal(blocked.body.plan, null);
  assert.deepEqual(blocked.body.issues, [
    { code: "unit_exists", id: 4 },
    { code: "location_exists", id: 3 },
    { code: "product_exists", id: 1 },
    { code: "barcode_taken", id: 1 },
  ]);
  const reuse = {
    ...rice,
    unit: { id: 4 },
    location: { id: 3 },
    product: { id: 1 },
  };
  const reused = await json(admin, "/api/pantry/groceries/proposal", reuse);
  assert.equal(reused.body.outcome, "plan");
  assert.deepEqual(reused.body.steps, ["stock_add"]);
  assert.equal(reused.body.plan.barcode, null);
  const tare = { ...tables.products?.[0], enable_tare_weight_handling: 1 };
  tables.products?.splice(0, 1, tare);
  const refused = await json(admin, "/api/pantry/groceries/proposal", reuse);
  assert.deepEqual(refused.body.issues, [{ code: "product_tare", id: 1 }]);

  assert.deepEqual(changes(), before);
  assert.equal(methods.includes("POST"), false);
});

test("grocery reads are owner-only and list overlaps and purchase candidates", async (context) => {
  const { admin, member, database, tables } = await setup(context);
  const mutationId = "00000000-0000-4000-8000-000000000001";
  const { request } = writeTransaction(database, (scope) =>
    store.insertGroceryRequest(
      scope,
      {
        ownerId: admin.user.id,
        userId: admin.user.id,
        mutationId,
        plan: JSON.stringify({ ...rice, product: { id: 1 } }),
        restoreNonce: store.currentNonce(database),
        steps: ["stock_add"],
        food: {
          values: {
            ...numbersFrom({ kcal: 160 }),
            name: "Example jasmine rice",
            serving_size: 45,
            serving_unit: "g",
            provenance: "label",
            source: "Example package label",
            source_food_id: null,
          },
        },
      },
      clock,
    ),
  );
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
    ...[41, 42].map((id) => ({
      id,
      product_id: 1,
      amount: 2.5,
      best_before_date: "2999-12-31",
      purchased_date: "2026-01-01",
      transaction_id: `tx${id}`,
      transaction_type: "purchase",
      location_id: 3,
      undone: 0,
    })),
  );

  const status = await json(admin, "/api/pantry/groceries/status", {
    mutation_id: mutationId,
  });
  assert.equal(status.body.request.steps[0].state, "uncertain");
  assert.deepEqual(status.body.request.candidates, {
    transactions: ["tx42"],
    complete: true,
  });
  assert.deepEqual(status.body.open, [
    { mutation_id: mutationId, state: "open" },
  ]);
  const overlapping = await json(admin, "/api/pantry/groceries/proposal", rice);
  assert.deepEqual(overlapping.body.plan.overlaps, [mutationId]);

  for (const [path, body, code] of [
    ["/api/pantry/groceries/proposal", rice, 403],
    ["/api/pantry/groceries/status", {}, 403],
    ["/api/pantry/groceries/status", { mutation_id: mutationId }, 404],
  ] as const)
    assert.equal((await json(member, path, body)).status, code);
});

test("grocery responses withhold the private Grocy address while the public link stays", async (context) => {
  assert.deepEqual(grocyLocators("http://grocy:9283/api"), [
    "http://grocy:9283",
    "//grocy:9283",
    "//grocy",
    "grocy:9283",
  ]);
  assert.deepEqual(grocyLocators("http://[FD00::5]/api"), [
    "http://[fd00::5]",
    "//[fd00::5]",
    "[fd00::5]",
    "fd00::5",
  ]);
  const frame = `event: message\ndata: ${JSON.stringify({ text: "HTTP://10.0.0.5:9283/api" })}\n\n`;
  const sse = await guardPantryResponse(
    new Response(frame, { headers: { "content-type": "text/event-stream" } }),
    "invented-secret",
    grocyLocators("http://10.0.0.5:9283/api"),
  );
  assert.equal(await sse.text(), "");

  const { admin, app, database } = await setup(context);
  const copied = { ...rice, product: { create: { name: "http://grocy/api" } } };
  const http = await admin.request("/api/pantry/groceries/proposal", {
    method: "POST",
    body: JSON.stringify(copied),
  });
  assert.equal(http.status, 503);
  assert.equal((await http.text()).includes("//grocy"), false);
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
