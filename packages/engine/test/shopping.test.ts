import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { loadConfig } from "../src/config.ts";
import { createGroceryClient } from "../src/grocy/grocery.ts";
import { createShoppingService } from "../src/pantry/shopping.ts";
import { accessConfig, mcpSession } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { grocy, grocyFetch, json } from "./support/pantry-fake.ts";
import { disabledStock } from "./support/stock.ts";
import { twoUsers } from "./support/two-users.ts";

type Row = Record<string, unknown>;
const empty = () => new Response(null, { status: 204 });

/** A Grocy whose add-missing call lists below-minimum products, as 4.7.1 does. */
async function setup(context: TestContext) {
  const tables: Record<string, Row[]> = {
    products: ["Example broccoli", "Example foil"].map((name, index) => ({
      id: index + 1,
      name,
      min_stock_amount: 0,
      shopping_location_id: null,
    })),
    shopping_locations: [],
    shopping_list: [],
    quantity_units: [{ id: 4, name: "Bag", name_plural: "Bags", active: 1 }],
  };
  const sent: string[] = [];
  const fake = grocyFetch({
    "/system/info": { grocy_version: { Version: "4.7.1" } },
    "/objects/products": () => tables.products,
    "/objects/products/:id": ({ id, body }: { id: string; body?: Row }) => {
      const product = tables.products?.find((row) => row.id === Number(id));
      if (!product)
        return Response.json(
          { error_message: body ? "Object not found" : "" },
          { status: body ? 400 : 404 },
        );
      if (!body) return product;
      Object.assign(product, body);
      return empty();
    },
    "/objects/shopping_locations": (request: {
      search: URLSearchParams;
      body?: Row;
    }) => {
      const rows = tables.shopping_locations ?? [];
      if (request.body)
        return {
          created_object_id: String(
            rows.push({ ...request.body, id: rows.length + 1 }),
          ),
        };
      return rows.filter((row) =>
        [null, `name=${row.name}`].includes(request.search.get("query[]")),
      );
    },
    "/stock/shoppinglist/add-missing-products": () => {
      for (const product of tables.products ?? [])
        if (
          Number(product.min_stock_amount) > 0 &&
          !tables.shopping_list?.some((row) => row.product_id === product.id)
        )
          tables.shopping_list?.push({
            id: Number(product.id) + 100,
            product_id: product.id,
            note: null,
            amount: product.min_stock_amount,
            qu_id: 4,
            done: 0,
            shopping_list_id: 1,
          });
      return empty();
    },
    "/objects/shopping_list": () => tables.shopping_list,
    "/objects/quantity_units": () => tables.quantity_units,
  });
  const wired: { shopping?: object } = {};
  const harness = await twoUsers(context, "access", {
    shopping: new Proxy({} as never, {
      get: (_target, key) => Reflect.get(wired.shopping ?? {}, key),
    }),
    pantry: {} as never,
    stock: disabledStock,
    config: {
      ...loadConfig({ DATABASE_URL: ":memory:" }),
      ...accessConfig,
      grocy,
    },
  });
  const ownerId = harness.admin.user.id;
  harness.database
    .prepare(
      "INSERT INTO pantry_connection (id, generation, url, username, user_id) VALUES (1, 1, ?, ?, ?)",
    )
    .run(grocy.url, grocy.username, ownerId);
  wired.shopping = createShoppingService({
    database: harness.database,
    config: grocy,
    ownerId,
    client: createGroceryClient({
      config: grocy,
      ownerId,
      fetch: (url, init) => {
        sent.push(`${init?.method} ${new URL(String(url)).pathname}`);
        return fake.fetch(url, init);
      },
    }),
  });
  const save = (
    product_id: number,
    min_stock_amount: number,
    store: string | null,
  ) =>
    json(harness.admin, "/api/pantry/shopping/minimum", {
      product_id,
      min_stock_amount,
      store,
    });
  return { ...harness, tables, fake, save, sent };
}

test("save_shopping_minimum creates the store once, reuses it and clears it", async (context) => {
  const { tables, save, fake, sent } = await setup(context);
  const wegmans = { id: 1, name: "Wegmans" };
  const first = await save(1, 2, "Wegmans");
  assert.deepEqual(
    [first.status, first.body],
    [
      200,
      {
        product_id: 1,
        name: "Example broccoli",
        min_stock_amount: 2,
        store: wegmans,
        store_created: true,
      },
    ],
  );
  const second = await save(2, 1, "Wegmans");
  assert.deepEqual(
    [
      second.body.store,
      second.body.store_created,
      tables.shopping_locations?.length,
    ],
    [wegmans, false, 1],
  );
  const cleared = await save(2, 1, null);
  assert.deepEqual(
    [cleared.body.store, tables.products?.[1]?.shopping_location_id],
    [null, null],
  );
  const missing = await save(9, 1, null);
  assert.deepEqual(
    [missing.status, missing.body.error.code],
    [404, "pantry_product_missing"],
  );
  fake.routes["/objects/products/:id"] = ({ body }: { body?: Row }) => {
    if (!body) return tables.products?.[0];
    throw new Error("Response lost");
  };
  sent.length = 0;
  const lost = await save(1, 3, null);
  assert.deepEqual(
    [
      lost.status,
      lost.body.error.code,
      sent.filter(
        (call) => call.endsWith("/products/1") && !call.startsWith("GET"),
      ),
    ],
    [503, "pantry_write_uncertain", ["PUT /api/objects/products/1"]],
  );
});

test("refresh_shopping_list over MCP groups items by store, storeless last", async (context) => {
  const harness = await setup(context);
  await harness.save(1, 2, "Wegmans");
  await harness.save(2, 1, null);
  const item = (
    id: number,
    product_id: number | null,
    name: string,
    amount: number,
    unit: string | null,
  ) => ({ id, product_id, name, amount, unit, done: false });
  harness.tables.shopping_list?.push({
    ...item(9, null, "", 1, null),
    note: "Example candles",
    qu_id: null,
    done: 0,
    shopping_list_id: 1,
  });
  const client = await mcpSession(context, harness, harness.admin.user.id);
  const result = await client.callTool({
    name: "refresh_shopping_list",
    arguments: {},
  });
  assert.deepEqual(result.structuredContent, {
    state: "ready",
    error: null,
    stores: [
      {
        store: { id: 1, name: "Wegmans" },
        items: [item(101, 1, "Example broccoli", 2, "Bags")],
      },
      {
        store: null,
        items: [
          item(9, null, "Example candles", 1, null),
          item(102, 2, "Example foil", 1, "Bag"),
        ],
      },
    ],
  });
});

test("refresh_shopping_list tells an empty list from an unreachable or malformed Grocy", async (context) => {
  const { admin, fake, sent, database } = await setup(context);
  const refresh = async () =>
    (await json(admin, "/api/pantry/shopping", {})).body;
  assert.deepEqual(await refresh(), {
    state: "ready",
    error: null,
    stores: [],
  });
  const unreachable = () => {
    throw new Error("Connection refused");
  };
  fake.routes["/stock/shoppinglist/add-missing-products"] = unreachable;
  sent.length = 0;
  assert.deepEqual(await refresh(), {
    state: "unavailable",
    error: { reason: "write_uncertain" },
    stores: [],
  });
  assert.equal(sent.filter((call) => call.includes("add-missing")).length, 1);
  fake.routes["/stock/shoppinglist/add-missing-products"] = () =>
    new Response(null, { status: 204 });
  for (const [route, error] of [
    [unreachable, { reason: "transport" }],
    [
      [{ id: 1, product_id: 1 }],
      { reason: "invalid_response", http_status: 200 },
    ],
  ]) {
    fake.routes["/objects/shopping_list"] = route;
    assert.deepEqual(await refresh(), {
      state: "unavailable",
      error,
      stores: [],
    });
  }
  database.prepare("UPDATE pantry_connection SET reset_required = 1").run();
  sent.length = 0;
  const pending = await json(admin, "/api/pantry/shopping", {});
  assert.deepEqual(
    [pending.status, pending.body.error.code, sent],
    [503, "pantry_reset_required", []],
  );
});

test("refresh_shopping_list is disabled without Grocy", async (context) => {
  const harness = await twoUsers(context, "access", {
    config: { ...loadConfig({ DATABASE_URL: ":memory:" }), ...accessConfig },
  });
  const { body } = await json(harness.admin, "/api/pantry/shopping", {});
  assert.deepEqual(body, { state: "disabled", error: null, stores: [] });
});
