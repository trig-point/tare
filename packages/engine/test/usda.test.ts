import assert from "node:assert/strict";
import { checkRecord } from "@tare/nutrition";
import { createUsdaAdapter, type UsdaFood } from "../src/sources/usda.ts";
import { test } from "./support/hang-ceiling.ts";

const retrievedAt = "2026-11-02T04:00:00.000Z";
const now = () => new Date(retrievedAt);
const config = { usdaApiKey: "fixture-key" };

// Values copied from live FoodData Central responses captured on 2026-11-02.
const searchFoods = {
  branded: {
    dataType: "Branded",
    fdcId: 2095236,
    description: "CHEDDAR CHEESE",
    brandName: "AMISH CLASSICS",
    brandOwner: "MDS Foods Inc.",
    gtinUpc: "828653282457",
    servingSizeUnit: "g",
    foodNutrients: [
      { nutrientId: 1003, value: 25, unitName: "G" },
      { nutrientId: 1004, value: 35.7, unitName: "G" },
      { nutrientId: 1005, value: 0, unitName: "G" },
      { nutrientId: 1008, value: 432, unitName: "KCAL" },
      { nutrientId: 1079, value: 0, unitName: "G" },
    ],
  },
  foundation: {
    dataType: "Foundation",
    fdcId: 328637,
    description: "Cheese, cheddar",
    brandName: null,
    gtinUpc: null,
    servingSizeUnit: null,
    foodNutrients: [
      { nutrientId: 1127, value: 0, unitName: "MG" },
      { nutrientId: 1005, value: 2.44, unitName: "G" },
      { nutrientId: 1008, value: 408, unitName: "KCAL" },
      { nutrientId: 1003, value: 23.3, unitName: "G" },
      { nutrientId: 1062, value: 1710, unitName: "kJ" },
      { nutrientId: 1004, value: 34, unitName: "G" },
    ],
  },
  legacy: {
    dataType: "SR Legacy",
    fdcId: 169901,
    description: "Cheese, american cheddar, imitation",
    foodNutrients: [
      { nutrientId: 1105, value: 111, unitName: "UG" },
      { nutrientId: 1003, value: 16.7, unitName: "G" },
      { nutrientId: 1062, value: 1000, unitName: "kJ" },
      { nutrientId: 1079, value: 0, unitName: "G" },
      { nutrientId: 1004, value: 14, unitName: "G" },
      { nutrientId: 1005, value: 11.6, unitName: "G" },
      { nutrientId: 1008, value: 239, unitName: "KCAL" },
    ],
  },
  volume: {
    dataType: "Branded",
    fdcId: 2616918,
    description: "WHOLE MILK",
    brandName: "UPSTATE FARMS",
    brandOwner: "Upstate Niagara Cooperative, Inc.",
    gtinUpc: "0078800112100",
    servingSizeUnit: "MLT",
    foodNutrients: [
      { nutrientId: 1003, value: 3.33, unitName: "G" },
      { nutrientId: 1004, value: 3.33, unitName: "G" },
      { nutrientId: 1005, value: 5, unitName: "G" },
      { nutrientId: 1008, value: 62, unitName: "KCAL" },
      { nutrientId: 1079, value: 0, unitName: "G" },
    ],
  },
} satisfies Record<string, UsdaFood>;

const header = { nutrient: { id: 2045, unitName: "g" } };
const detailFoods = {
  branded: {
    ...searchFoods.branded,
    foodNutrients: [
      { nutrient: { id: 1008, unitName: "kcal" }, amount: 432 },
      { nutrient: { id: 1004, unitName: "g" }, amount: 35.71 },
      { nutrient: { id: 1003, unitName: "g" }, amount: 25 },
      { nutrient: { id: 1005, unitName: "g" }, amount: 0 },
      { nutrient: { id: 1079, unitName: "g" }, amount: 0 },
    ],
  },
  foundation: {
    ...searchFoods.foundation,
    foodNutrients: [
      header,
      { nutrient: { id: 1008, unitName: "kcal" }, amount: 408 },
      { nutrient: { id: 1062, unitName: "kJ" }, amount: 1710 },
      { nutrient: { id: 1003, unitName: "g" }, amount: 23.3 },
      { nutrient: { id: 1004, unitName: "g" }, amount: 34 },
      { nutrient: { id: 1005, unitName: "g" }, amount: 2.44 },
    ],
  },
  legacy: {
    ...searchFoods.legacy,
    foodNutrients: [
      header,
      { nutrient: { id: 1008, unitName: "kcal" }, amount: 239 },
      { nutrient: { id: 1062, unitName: "kJ" }, amount: 1000 },
      { nutrient: { id: 1003, unitName: "g" }, amount: 16.7 },
      { nutrient: { id: 1004, unitName: "g" }, amount: 14 },
      { nutrient: { id: 1005, unitName: "g" }, amount: 11.6 },
      { nutrient: { id: 1079, unitName: "g" }, amount: 0 },
    ],
  },
  volume: {
    ...searchFoods.volume,
    foodNutrients: [
      { nutrient: { id: 1008, unitName: "kcal" }, amount: 62 },
      { nutrient: { id: 1004, unitName: "g" }, amount: 3.33 },
      { nutrient: { id: 1079, unitName: "g" }, amount: 0 },
      { nutrient: { id: 1003, unitName: "g" }, amount: 3.33 },
      { nutrient: { id: 1005, unitName: "g" }, amount: 5 },
    ],
  },
} satisfies Record<string, UsdaFood>;

// Label-serving totals from the captures; the adapter must ignore them.
const labelNutrients = {
  branded: { protein: { value: 7 }, calories: { value: 121 } },
  foundation: undefined,
  legacy: undefined,
  volume: { protein: { value: 7.99 }, calories: { value: 149 } },
};

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
        assert.ok(init?.signal instanceof AbortSignal);
        return Response.json({ foods: [searchFoods[name]] });
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
    assert.equal(record.sourceId, String(searchFoods[name].fdcId));
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
    const body = { ...detailFoods[name], labelNutrients: labelNutrients[name] };
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
      assert.deepEqual(record.nutrients.carbs_g, {
        amount: 0,
        provenance: "label",
      });
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
  const food = {
    ...searchFoods.foundation,
    foodNutrients: searchFoods.foundation.foodNutrients.filter(
      (nutrient) => nutrient.nutrientId === 1062,
    ),
  };
  const result = await adapterFor({ foods: [food] }).search("cheddar");
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

test("Atwater energy is used when the standard energy entry is absent", async () => {
  const withoutEnergy = searchFoods.foundation.foodNutrients.filter(
    (nutrient) => nutrient.nutrientId !== 1008 && nutrient.nutrientId !== 1062,
  );
  const general = { nutrientId: 2047, value: 410, unitName: "KCAL" };
  const specific = { nutrientId: 2048, value: 405, unitName: "KCAL" };
  for (const [entries, calories] of [
    [[general, specific], 405],
    [[general], 410],
  ] as const) {
    const food = {
      ...searchFoods.foundation,
      foodNutrients: [...withoutEnergy, ...entries],
    };
    const result = await adapterFor({ foods: [food] }).search("cheddar");
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.deepEqual(result.records[0]?.nutrients.kcal, {
      amount: calories,
      provenance: "verified",
    });
  }
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
  const valid = searchFoods.branded;
  const { foodNutrients: _omitted, ...withoutNutrients } = valid;
  const invalidFoods = [
    null,
    { ...valid, dataType: "Survey (FNDDS)" },
    { ...valid, fdcId: null },
    { ...valid, description: "" },
    { ...valid, servingSizeUnit: "unknown" },
    withoutNutrients,
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
  const wrongId = await adapterFor(detailFoods.branded).fetchById("1");
  assert.deepEqual(wrongId, { status: "ok", records: [], rejected: 1 });
});

test("a malformed barcode drops only the barcode", async () => {
  const result = await adapterFor({
    foods: [{ ...searchFoods.branded, gtinUpc: "bad-barcode" }],
  }).search("cheddar");
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.rejected, 0);
  assert.equal(result.records[0]?.barcode, null);
  assert.equal(result.records[0]?.nutrients.kcal?.amount, 432);
});

test("a food detail missing foodNutrients is an invalid response", async () => {
  const { foodNutrients: _omitted, ...withoutNutrients } = detailFoods.branded;
  assert.deepEqual(await adapterFor(withoutNutrients).fetchById("2095236"), {
    status: "error",
    reason: "invalid_response",
  });
});

test("HTTP failures and transport or JSON errors return sanitized errors without retries", async () => {
  for (const statusCode of [429, 500, 503]) {
    let calls = 0;
    const response = new Response("fixture-key", { status: statusCode });
    const adapter = createUsdaAdapter(config, {
      fetch: async () => {
        calls += 1;
        return response;
      },
    });
    assert.deepEqual(await adapter.search("cheddar"), {
      status: "error",
      reason: "http",
      statusCode,
    });
    assert.equal(calls, 1);
    assert.equal(response.bodyUsed, true);
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

test("empty searches and malformed ids fail before the key check and any request", async () => {
  for (const usdaApiKey of ["fixture-key", undefined]) {
    const adapter = createUsdaAdapter(
      { usdaApiKey },
      {
        fetch: async () => assert.fail("invalid request must not reach USDA"),
      },
    );
    const invalid = { status: "error", reason: "invalid_request" };
    assert.deepEqual(await adapter.search("   "), invalid);
    for (const identifier of [
      "",
      "0",
      "-1",
      "1.5",
      "abc",
      "../foods",
      "9007199254740992",
    ])
      assert.deepEqual(await adapter.fetchById(identifier), invalid);
  }
});
