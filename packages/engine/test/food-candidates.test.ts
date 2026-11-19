import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { createOffAdapter } from "../src/sources/off.ts";
import { createUsdaAdapter, type UsdaFood } from "../src/sources/usda.ts";
import { mcpSession } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const usdaFood = (
  fdcId: number,
  dataType: string,
  description: string,
  kcal: number | null,
  extra: Partial<UsdaFood> = {},
): UsdaFood => ({
  fdcId,
  dataType,
  description,
  foodNutrients:
    kcal === null ? [] : [{ nutrientId: 1008, value: kcal, unitName: "KCAL" }],
  ...extra,
});
const branded = usdaFood(3001, "Branded", "EXAMPLE COOKED RICE", 140, {
  brandName: "EXAMPLE FARMS",
  servingSizeUnit: "g",
});
const legacy = usdaFood(3002, "SR Legacy", "Rice, white, cooked", 130);
const drink = usdaFood(3003, "Branded", "EXAMPLE RICE DRINK", 47, {
  servingSizeUnit: "ml",
});
const foundation = usdaFood(3004, "Foundation", "Rice, white, boiled", 128);
const unlabeled = usdaFood(3005, "Branded", "EXAMPLE RICE BOWL", null, {
  servingSizeUnit: "g",
  foodNutrients: [{ nutrientId: 1003, value: 3, unitName: "G" }],
});

async function setup(context: TestContext, key = true) {
  const calls: string[] = [];
  const responses: Record<string, Response | (() => Response)> = {};
  const usdaFetch: typeof fetch = async (input) => {
    const path = new URL(String(input)).pathname.replace("/fdc/v1/", "");
    calls.push(path);
    const response = responses[path];
    if (typeof response === "function") return response();
    return response ?? Response.json({}, { status: 404 });
  };
  const lookup = {
    usda: createUsdaAdapter(
      { usdaApiKey: key ? "fixture-key" : undefined },
      { fetch: usdaFetch },
    ),
    off: createOffAdapter({
      userAgent: "Tare/1.0 (support@example.com)",
      fetch: async () => assert.fail("Open Food Facts was called"),
    }),
  };
  const users = await twoUsers(context, "fallback", { lookup });
  const send = async (path: string, body: unknown) => {
    const response = await users.admin.request(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { status: response.status, ...(await response.json()) };
  };
  const rows = () =>
    users.database.prepare("SELECT count(*) AS count FROM source_foods").get();
  return { calls, responses, send, rows, database: users.database };
}

test("candidate search puts generic mass-basis hits before Branded and writes nothing", async (context) => {
  const { responses, send, rows, calls } = await setup(context);
  const body = { foods: [branded, legacy, drink, unlabeled, foundation] };
  responses["foods/search"] = () => Response.json(body);
  const found = await send("/api/lookup/candidates", {
    query: " white rice cooked ",
  });
  assert.equal(found.status, 200);
  assert.deepEqual(found.candidates[2], {
    fdc_id: 3001,
    name: "EXAMPLE COOKED RICE",
    data_type: "Branded",
    brand: "EXAMPLE FARMS",
    kcal_per_100g: 140,
  });
  type Candidate = Record<string, unknown>;
  const summary = (list: Candidate[]) =>
    list.map((hit) => [hit.fdc_id, hit.data_type, hit.kcal_per_100g]);
  assert.deepEqual(summary(found.candidates), [
    [3002, "SR Legacy", 130],
    [3004, "Foundation", 128],
    [3001, "Branded", 140],
    [3005, "Branded", null],
  ]);
  const limited = await send("/api/lookup/candidates", {
    query: "rice",
    limit: 1,
  });
  assert.deepEqual(summary(limited.candidates), [[3002, "SR Legacy", 130]]);
  assert.deepEqual(calls, ["foods/search", "foods/search"]);
  assert.deepEqual(rows(), { count: 0 });
});

test("add_source_food stores one row per id with the adapter's provenance", async (context) => {
  const { responses, send, rows, calls } = await setup(context);
  responses["food/3002"] = () => Response.json(legacy);
  responses["food/3001"] = () => Response.json(branded);
  const first = await send("/api/lookup/source-food", { fdc_id: 3002 });
  assert.equal(first.status, 200);
  assert.equal(first.name, "Rice, white, cooked");
  assert.equal(first.provenance, "verified");
  assert.equal(first.serving_size, 100);
  assert.equal(first.serving_unit, "g");
  const again = await send("/api/lookup/source-food", { fdc_id: 3002 });
  assert.deepEqual(again, first);
  const label = await send("/api/lookup/source-food", { fdc_id: 3001 });
  assert.equal(label.provenance, "label");
  let kcal = 128;
  responses["food/3004"] = () =>
    Response.json({
      ...foundation,
      foodNutrients: [{ nutrientId: 1008, value: kcal++, unitName: "KCAL" }],
    });
  const [left, right] = await Promise.all(
    [0, 1].map(() => send("/api/lookup/source-food", { fdc_id: 3004 })),
  );
  assert.deepEqual(right, left);
  assert.deepEqual(calls, ["food/3002", "food/3001", "food/3004", "food/3004"]);
  assert.deepEqual(rows(), { count: 3 });
});

test("lookup failures answer explicit codes and write nothing", async (context) => {
  const { responses, send, rows } = await setup(context);
  responses["foods/search"] = Response.json({ foods: [drink] });
  const cachedDrink = await send("/api/lookup/search", {
    name: drink.description,
  });
  assert.equal(cachedDrink.result, "match");
  responses["food/3008"] = Response.json({
    ...branded,
    fdcId: 3008,
    servingSizeUnit: "each",
  });
  responses["food/3009"] = Response.json({
    ...legacy,
    fdcId: 3009,
    dataType: "Survey (FNDDS)",
  });
  responses["food/3010"] = () => {
    throw new TypeError("fetch failed");
  };
  responses["food/3006"] = Response.json({}, { status: 429 });
  responses["food/3007"] = Response.json({ fdcId: "not a food" });
  responses["foods/search"] = Response.json({ foods: [{ fdcId: "bad" }] });
  const cases = [
    ["source-food", { fdc_id: 3999 }, 404, "food_not_found"],
    ["source-food", { fdc_id: 3003 }, 400, "no_mass_basis"],
    ["source-food", { fdc_id: 3008 }, 400, "no_mass_basis"],
    ["source-food", { fdc_id: 3009 }, 400, "unsupported_food"],
    ["source-food", { fdc_id: 3010 }, 503, "lookup_failed"],
    ["source-food", { fdc_id: 3006 }, 503, "lookup_rate_limited"],
    ["source-food", { fdc_id: 3007 }, 503, "lookup_invalid_response"],
    ["candidates", { query: "rice" }, 503, "lookup_invalid_response"],
  ] as const;
  for (const [path, body, status, code] of cases) {
    const refused = await send(`/api/lookup/${path}`, body);
    assert.deepEqual([refused.status, refused.error?.code], [status, code]);
  }
  assert.deepEqual(rows(), { count: 1 });
});

test("both operations answer lookup_unavailable without a USDA key", async (context) => {
  const { send, calls, database } = await setup(context, false);
  database
    .prepare(
      "INSERT INTO source_foods (source, source_key, name, serving_size, serving_unit, kcal, provenance, fetched_at) VALUES ('usda', '3002', 'Rice, white, cooked', 100, 'g', 130, 'verified', '2026-01-05T00:00:00.000Z')",
    )
    .run();
  for (const [path, body] of [
    ["candidates", { query: "rice" }],
    ["source-food", { fdc_id: 3002 }],
  ] as const) {
    const refused = await send(`/api/lookup/${path}`, body);
    assert.deepEqual(
      [refused.status, refused.error?.code],
      [503, "lookup_unavailable"],
    );
  }
  assert.deepEqual(calls, []);
});

test("MCP lists both operations with descriptions", async (context) => {
  const setup = await twoUsers(context, "access");
  const client = await mcpSession(context, setup, setup.admin.user.id);
  const { tools } = await client.listTools();
  for (const name of ["search_food_candidates", "add_source_food"])
    assert.ok(
      tools.find((tool: { name: string }) => tool.name === name)?.description,
      name,
    );
});
