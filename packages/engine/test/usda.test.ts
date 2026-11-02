import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkRecord } from "@tare/nutrition";
import { createUsdaAdapter } from "../src/sources/usda.ts";
import { test } from "./support/hang-ceiling.ts";

const retrievedAt = "2026-11-02T04:00:00.000Z";
const now = () => new Date(retrievedAt);
const config = { usdaApiKey: "fixture-key" };

function fixture(name: string) {
  return JSON.parse(
    readFileSync(
      new URL(`./fixtures/usda/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}

function adapterFor(body: unknown) {
  return createUsdaAdapter(config, {
    now,
    fetch: async () => Response.json(body),
  });
}

test("search maps recorded data types to provenance and requests only supported types", async () => {
  for (const [name, provenance, calories] of [
    ["branded", "label", 432],
    ["foundation", "verified", 408],
    ["legacy", "verified", 239],
    ["volume", "label", 62],
  ] as const) {
    const adapter = createUsdaAdapter(config, {
      now,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        assert.equal(url.origin, "https://api.nal.usda.gov");
        assert.equal(url.pathname, "/fdc/v1/foods/search");
        assert.equal(url.searchParams.get("query"), "cheddar cheese");
        assert.equal(
          url.searchParams.get("dataType"),
          "Foundation,SR Legacy,Branded",
        );
        assert.equal(url.searchParams.has("api_key"), false);
        assert.equal(
          new Headers(init?.headers).get("X-Api-Key"),
          "fixture-key",
        );
        return Response.json(fixture(`search-${name}`));
      },
    });
    const result = await adapter.search("  cheddar cheese  ");
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.rejected, 0);
    const record = result.records[0];
    assert.ok(record);
    assert.deepEqual(record.nutrients.kcal, { amount: calories, provenance });
    assert.equal(record.retrievedAt, retrievedAt);
    assert.equal(
      record.sourceId,
      String(fixture(`search-${name}`).foods[0].fdcId),
    );
    assert.equal(record.source, "usda");
    assert.equal(record.mealKit, null);
    assert.deepEqual(record.basis, {
      dimension: name === "volume" ? "volume" : "mass",
      amount: 100,
      unit: name === "volume" ? "ml" : "g",
    });
    for (const value of Object.values(record.nutrients))
      if (value !== null) assert.equal(value.provenance, provenance);
    for (const record of result.records)
      assert.deepEqual(checkRecord(record), []);
  }
});

test("fetch by id maps recorded details without using label-serving totals", async () => {
  for (const [name, protein] of [
    ["branded", 25],
    ["foundation", 23.3],
    ["legacy", 16.7],
    ["volume", 3.33],
  ] as const) {
    const body = fixture(`food-${name}`);
    const adapter = createUsdaAdapter(config, {
      now,
      fetch: async (input, init) => {
        assert.equal(
          new URL(String(input)).pathname,
          `/fdc/v1/food/${body.fdcId}`,
        );
        assert.equal(
          new Headers(init?.headers).get("X-Api-Key"),
          "fixture-key",
        );
        return Response.json(body);
      },
    });
    const result = await adapter.fetchById(String(body.fdcId));
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.rejected, 0);
    assert.equal(result.records.length, 1);
    const record = result.records[0];
    assert.ok(record);
    assert.equal(record.nutrients.protein_g?.amount, protein);
    assert.equal(record.basis?.amount, 100);
    assert.equal(record.basis?.unit, name === "volume" ? "ml" : "g");
    if (name === "branded") {
      assert.equal(record.brand, "AMISH CLASSICS");
      assert.equal(record.barcode, "828653282457");
      assert.equal(record.nutrients.kcal?.amount, 432);
    }
    if (name === "foundation") assert.equal(record.nutrients.fiber_g, null);
    assert.deepEqual(checkRecord(record), []);
  }
});

test("missing keys skip both operations without making a request", async () => {
  for (const usdaApiKey of [undefined, "", "   "]) {
    const adapter = createUsdaAdapter(
      { usdaApiKey },
      {
        fetch: async () => assert.fail("USDA must be skipped"),
      },
    );
    const skipped = { status: "skipped", reason: "missing_key" };
    assert.deepEqual(await adapter.search("cheddar"), skipped);
    assert.deepEqual(await adapter.fetchById("2095236"), skipped);
  }
});

test("energy in kJ converts to kcal and absent nutrients stay unknown", async () => {
  const body = fixture("search-foundation");
  body.foods[0].foodNutrients = body.foods[0].foodNutrients.filter(
    (nutrient: { nutrientId: number }) => nutrient.nutrientId === 1062,
  );
  const result = await adapterFor(body).search("cheddar");
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.records[0]?.nutrients, {
    kcal: { amount: 1710 / 4.184, provenance: "verified" },
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    fiber_g: null,
  });
});

test("empty results differ from malformed responses and rejected records are counted", async () => {
  assert.deepEqual(await adapterFor({ foods: [] }).search("cheddar"), {
    status: "ok",
    records: [],
    rejected: 0,
  });
  for (const body of [null, {}, { foods: null }, { foods: {} }])
    assert.deepEqual(await adapterFor(body).search("cheddar"), {
      status: "error",
      reason: "invalid_response",
    });
  const valid = fixture("search-branded").foods[0];
  const invalidFoods = [
    null,
    { ...valid, dataType: "Survey (FNDDS)" },
    { ...valid, fdcId: null },
    { ...valid, description: "" },
    { ...valid, servingSizeUnit: "unknown" },
    { ...valid, gtinUpc: "bad-barcode" },
    { ...valid, foodNutrients: [] },
    {
      ...valid,
      foodNutrients: [{ nutrientId: 1008, value: -1, unitName: "KCAL" }],
    },
  ];
  const result = await adapterFor({ foods: [...invalidFoods, valid] }).search(
    "cheddar",
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.rejected, invalidFoods.length);
  assert.equal(result.records.length, 1);
  const wrongId = await adapterFor(fixture("food-branded")).fetchById("1");
  assert.deepEqual(wrongId, { status: "ok", records: [], rejected: 1 });
});

test("HTTP failures and transport or JSON errors return sanitized errors without retries", async () => {
  for (const statusCode of [429, 500, 503]) {
    let calls = 0;
    const adapter = createUsdaAdapter(config, {
      fetch: async () => {
        calls += 1;
        return new Response("fixture-key", { status: statusCode });
      },
    });
    assert.deepEqual(await adapter.search("cheddar"), {
      status: "error",
      reason: "http",
      statusCode,
    });
    assert.equal(calls, 1);
  }
  const failing = createUsdaAdapter(config, {
    fetch: async () => {
      throw new Error("fixture-key");
    },
  });
  assert.deepEqual(await failing.fetchById("2095236"), {
    status: "error",
    reason: "network",
  });
  const malformed = createUsdaAdapter(config, {
    fetch: async () => new Response("not-json"),
  });
  assert.deepEqual(await malformed.search("cheddar"), {
    status: "error",
    reason: "invalid_response",
  });
});

test("empty searches and malformed ids fail without making a request", async () => {
  const adapter = createUsdaAdapter(config, {
    fetch: async () => assert.fail("invalid request must not reach USDA"),
  });
  const invalid = { status: "error", reason: "invalid_request" };
  assert.deepEqual(await adapter.search("   "), invalid);
  for (const identifier of [
    "",
    "0",
    "-1",
    "1.5",
    "../foods",
    "9007199254740992",
  ])
    assert.deepEqual(await adapter.fetchById(identifier), invalid);
});
