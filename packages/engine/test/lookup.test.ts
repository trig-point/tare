import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyPassword } from "../src/auth/password.ts";
import { loadConfig } from "../src/config.ts";
import {
  lookupBarcode,
  type OnlineLookupResult,
  searchOnline,
} from "../src/lookup/index.ts";
import { lookupOperations } from "../src/lookup/operations.ts";
import { executeOperation } from "../src/operations/registry.ts";
import { selectSourceFood } from "../src/queries/select-source-food.ts";
import { createOffAdapter, type OffProduct } from "../src/sources/off.ts";
import { createUsdaAdapter, type UsdaFood } from "../src/sources/usda.ts";
import {
  accessConfig,
  cookie,
  dummyHash,
  fixture,
  issuedAt,
  requestedWith,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const upc = "828653282457";
const barcode = "3017624010701";
const cheddar: UsdaFood = {
  dataType: "Branded",
  fdcId: 2095236,
  description: "CHEDDAR CHEESE",
  brandName: "AMISH CLASSICS",
  gtinUpc: upc,
  servingSizeUnit: "g",
  foodNutrients: [{ nutrientId: 1008, value: 432, unitName: "KCAL" }],
};
const product: OffProduct = {
  code: barcode,
  product_name: "Nutella",
  brands: "Ferrero",
  nutrition_data_per: "100g",
  nutriments: { "energy-kcal_100g": 539, proteins_100g: 6.3 },
};
function peers(key = true) {
  const calls: string[] = [];
  const queries: (string | null)[] = [];
  let now = issuedAt;
  const bodies = {
    usda: { foods: [cheddar] } as unknown,
    off: { status: 1, product } as unknown,
  };
  const fetchResponse: typeof fetch = async (input) => {
    const source =
      new URL(String(input)).hostname === "api.nal.usda.gov" ? "usda" : "off";
    calls.push(source);
    if (source === "usda")
      queries.push(new URL(String(input)).searchParams.get("query"));
    return Response.json(bodies[source]);
  };
  const adapters = {
    usda: createUsdaAdapter(
      { usdaApiKey: key ? "fixture-key" : undefined },
      { fetch: fetchResponse, now: () => now },
    ),
    off: createOffAdapter({
      userAgent: "Tare/1.0 (support@example.com)",
      fetch: fetchResponse,
    }),
  };
  return {
    adapters,
    calls,
    queries,
    bodies,
    step: () => {
      now = new Date(now.getTime() + 1000);
    },
  };
}

test("USDA normalizes UPC and the shared cache serves both people without exposing owned foods", async (context) => {
  for (const mode of ["access", "fallback"] as const) {
    const setup = await twoUsers(context, mode);
    const peer = peers();
    const deps = {
      database: setup.database,
      config:
        mode === "access"
          ? accessConfig
          : loadConfig({ DATABASE_URL: ":memory:" }),
      clock: { now: () => issuedAt },
      dummyHash,
      verifyPassword,
      signInLimiter: { waiting: 0 },
      lookup: peer.adapters,
    };
    const [operation, searchOperation] = lookupOperations;
    assert.ok(operation && searchOperation);
    const run = async (person: typeof setup.admin, name?: string) =>
      (
        await executeOperation(
          name === undefined ? operation : searchOperation,
          name === undefined ? { barcode: `0${upc}` } : { name },
          {
            person: person.user,
            credential: mode === "access" ? "service" : "session",
          },
          deps,
        )
      ).body;
    setup.database
      .prepare(
        "INSERT INTO foods (user_id, name, kcal, provenance) VALUES (?, ?, ?, ?)",
      )
      .run(setup.admin.user.id, "Example private meal", 123, "label");
    const first = (await run(setup.admin)) as OnlineLookupResult;
    assert.equal(first.result, "match");
    assert.deepEqual(peer.calls, ["usda"]);
    assert.equal(first.foods[0]?.barcode, `0${upc}`);
    assert.equal(first.foods[0]?.fiber_g, null);
    assert.deepEqual(first.sources, { usda: "ok", off: "not_called" });
    assert.deepEqual(peer.queries, [`${upc} 0${upc}`]);
    peer.step();
    const second = (await run(setup.member)) as typeof first;
    assert.deepEqual(second.foods, first.foods);
    assert.deepEqual(second.sources, { usda: "not_called", off: "not_called" });
    assert.deepEqual(peer.calls, ["usda"]);
    assert.equal(
      selectSourceFood(setup.database, {
        id: first.foods[0]?.source_food_id ?? 0,
      })?.fetched_at,
      issuedAt.toISOString(),
    );
    peer.bodies.usda = { foods: [] };
    peer.bodies.off = { products: [] };
    assert.equal(
      ((await run(setup.member, "Example private meal")) as OnlineLookupResult)
        .result,
      "no_match",
    );
  }
});

test("USDA precedes OFF and a similar-name search writes nothing", async (context) => {
  const setup = fixture(context);
  const peer = peers();
  assert.equal(
    (await lookupBarcode(setup.database, peer.adapters, barcode)).foods[0]
      ?.source,
    "off",
  );
  assert.deepEqual(peer.calls, ["usda", "off"]);
  peer.bodies.off = { products: [product] };
  const miss = await searchOnline(
    setup.database,
    peer.adapters,
    "Nutella Plant-Based",
  );
  assert.equal(miss.result, "no_match");
  assert.equal(miss.foods.length, 0);
  assert.equal(
    setup.database
      .prepare<[], { count: number }>(
        "SELECT count(*) AS count FROM source_foods",
      )
      .get()?.count,
    1,
  );
});

test("a cached ambiguous barcode returns the same candidates without a vendor call", async (context) => {
  const setup = fixture(context);
  const peer = peers();
  peer.bodies.usda = { foods: [cheddar, { ...cheddar, fdcId: 2095237 }] };
  const first = await lookupBarcode(setup.database, peer.adapters, upc);
  assert.equal(first.result, "ambiguous");
  assert.equal(first.foods.length, 2);
  const second = await lookupBarcode(setup.database, peer.adapters, upc);
  assert.deepEqual(second.foods, first.foods);
  assert.equal(second.result, "ambiguous");
  assert.deepEqual(peer.calls, ["usda"]);
});

test("HTTP skips USDA without a key and migration backfills OFF", async (context) => {
  const peer = peers(false);
  const setup = fixture(context, { lookup: peer.adapters });
  const headers = { ...requestedWith, Cookie: cookie(await setup.signIn()) };
  const response = await setup.app.request("/api/lookup/barcode", {
    method: "POST",
    headers,
    body: JSON.stringify({ barcode }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).sources, {
    usda: "skipped",
    off: "ok",
  });
  assert.deepEqual(peer.calls, ["off"]);
  const oversized = await setup.app.request("/api/lookup/search", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "x".repeat(9000) }),
  });
  assert.equal(oversized.status, 413);
  setup.database.exec(
    "DROP INDEX source_foods_barcode; ALTER TABLE source_foods DROP COLUMN barcode",
  );
  setup.database.exec(
    readFileSync(
      new URL("../migrations/0008_source_food_barcode.sql", import.meta.url),
      "utf8",
    ),
  );
  peer.calls.length = 0;
  assert.equal(
    (await lookupBarcode(setup.database, peer.adapters, barcode)).result,
    "match",
  );
  assert.deepEqual(peer.calls, []);
});
