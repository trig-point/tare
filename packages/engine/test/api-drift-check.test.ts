import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  filterReadChanges,
  readPropertyNames,
  report,
  runChecks,
} from "../scripts/api-drift-check.mts";
import {
  type OffProductResponse,
  productResponseSchema,
} from "../src/sources/off.ts";
import {
  type UsdaFood,
  usdaFoodSchema,
  usdaSearchSchema,
} from "../src/sources/usda.ts";

const off: OffProductResponse = {
  status: 1,
  product: { code: "3017624010701", nutriments: { "energy-kcal_100g": 539 } },
};
const food: UsdaFood = {
  dataType: "Branded",
  fdcId: 2095236,
  description: "CHEDDAR CHEESE",
  servingSizeUnit: "g",
  foodNutrients: [{ nutrientId: 1008, unitName: "KCAL", value: 403 }],
};
const baseline = {
  offCommit: "a".repeat(40),
  usdaSha256: createHash("sha256").update("spec").digest("hex"),
};

function fixture(
  overrides: {
    off?: unknown;
    search?: unknown;
    detail?: unknown;
    httpStatus?: number;
    spec?: string;
    diff?: unknown;
  } = {},
) {
  const requests: { url: URL; headers: Headers }[] = [];
  const options: Parameters<typeof runChecks>[0] = {
    baseline,
    apiKey: "synthetic-test-key",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url, headers: new Headers(init?.headers) });
      if (overrides.httpStatus)
        return new Response(null, { status: overrides.httpStatus });
      if (url.pathname.endsWith(".yaml"))
        return new Response(overrides.spec ?? "spec");
      return Response.json(
        url.hostname === "world.openfoodfacts.org"
          ? overrides.off === undefined
            ? off
            : overrides.off
          : url.pathname.endsWith("search")
            ? overrides.search === undefined
              ? { foods: [food] }
              : overrides.search
            : overrides.detail === undefined
              ? food
              : overrides.detail,
      );
    },
    runOasdiff: async (base, revision) => {
      assert.ok(base.includes(baseline.offCommit));
      assert.ok(revision.includes("/main/"));
      return overrides.diff ?? {};
    },
  };
  return { options, requests };
}

test("known-good OFF and USDA responses and unchanged docs pass", async () => {
  const { options, requests } = fixture();
  const results = await runChecks(options);
  for (const checks of Object.values(results))
    for (const result of Object.values(checks))
      assert.equal(result.status, "pass");
  const search = requests.find(({ url }) => url.pathname.endsWith("search"));
  assert.equal(search?.url.searchParams.get("query"), "cheddar cheese");
  assert.equal(
    search?.url.searchParams.get("dataType"),
    "Foundation,SR Legacy,Branded",
  );
  assert.ok(
    requests.some(({ url }) => url.pathname.endsWith(`/food/${food.fdcId}`)),
  );
  assert.equal(report(results, "https://example.test/run/1").failed, false);
});

test("OFF missing product.code is drift naming that field and run", async () => {
  const results = await runChecks(
    fixture({ off: { status: 1, product: {} } }).options,
  );
  assert.equal(results.off.live.status, "drift");
  const output = report(results, "https://example.test/run/1");
  assert.equal(output.failed, true);
  assert.equal(output.outputs.off_drift, "true");
  assert.match(output.outputs.off_body ?? "", /product\.code/);
  assert.match(output.outputs.off_body ?? "", /https:\/\/example.test\/run\/1/);
});

test("OFF missing product and missing known energy are drift", async () => {
  for (const body of [
    { status: 0 },
    { status: 1, product: { code: "3017624010701" } },
  ]) {
    const results = await runChecks(fixture({ off: body }).options);
    assert.equal(results.off.live.status, "drift");
    assert.match(results.off.live.details.join(), /status|energy-kcal_100g/);
  }
});

test("USDA checks every search food and rejects missing fdcId", async () => {
  const { fdcId: omitted, ...missingId } = food;
  assert.ok(omitted);
  const results = await runChecks(
    fixture({ search: { foods: [food, missingId] } }).options,
  );
  assert.equal(results.usda.live.status, "drift");
  assert.match(results.usda.live.details.join(), /search\.foods\.1\.fdcId/);
});

test("USDA empty, missing and malformed search and mismatched detail are drift", async () => {
  for (const search of [{ foods: [] }, {}, { foods: null }, null]) {
    const results = await runChecks(fixture({ search }).options);
    assert.equal(results.usda.live.status, "drift");
  }
  const results = await runChecks(
    fixture({ detail: { ...food, fdcId: 1 } }).options,
  );
  assert.equal(results.usda.live.status, "drift");
  assert.match(results.usda.live.details.join(), /food\.fdcId/);
});

test("429 and other HTTP failures are unavailable, fail the run and request no issue", async () => {
  for (const httpStatus of [429, 503]) {
    const results = await runChecks(fixture({ httpStatus }).options);
    assert.equal(results.off.live.status, "unavailable");
    assert.equal(results.usda.live.status, "unavailable");
    const output = report(results, "https://example.test/run/1");
    assert.equal(output.failed, true);
    assert.equal(output.outputs.off_drift, "false");
    assert.equal(output.outputs.usda_drift, "false");
    assert.match(output.log, new RegExp(`HTTP ${httpStatus}`));
  }
});

test("USDA key is a header and never appears in output, including thrown errors", async () => {
  const { options, requests } = fixture();
  const results = await runChecks(options);
  const usdaRequests = requests.filter(
    ({ url }) => url.hostname === "api.nal.usda.gov",
  );
  assert.equal(usdaRequests.length, 2);
  for (const request of usdaRequests) {
    assert.equal(request.headers.get("X-Api-Key"), options.apiKey);
    assert.equal(request.url.searchParams.has("api_key"), false);
    assert.equal(request.url.href.includes(options.apiKey ?? ""), false);
  }
  assert.equal(
    JSON.stringify(report(results, "run")).includes(options.apiKey ?? ""),
    false,
  );
  options.fetch = async () => {
    throw new Error(options.apiKey);
  };
  options.runOasdiff = async () => {
    throw new Error(options.apiKey);
  };
  const unavailable = await runChecks(options);
  assert.equal(unavailable.off.live.status, "unavailable");
  assert.equal(unavailable.off.docs.status, "unavailable");
  assert.equal(unavailable.usda.live.status, "unavailable");
  assert.equal(unavailable.usda.docs.status, "unavailable");
  assert.equal(
    JSON.stringify(report(unavailable, "run")).includes(options.apiKey ?? ""),
    false,
  );
});

test("missing or empty USDA key uses DEMO_KEY in the header", async () => {
  for (const apiKey of [undefined, "  "]) {
    const { options, requests } = fixture();
    await runChecks({ ...options, apiKey });
    for (const request of requests.filter(
      ({ url }) => url.hostname === "api.nal.usda.gov",
    ))
      assert.equal(request.headers.get("X-Api-Key"), "DEMO_KEY");
  }
});

test("schema shape walk unwraps unions, arrays, optional, nullable and catch", () => {
  assert.deepEqual([...readPropertyNames(productResponseSchema)].sort(), [
    "brands",
    "carbohydrates_100g",
    "code",
    "energy-kcal_100g",
    "fat_100g",
    "fiber_100g",
    "nutriments",
    "nutrition_data_per",
    "product",
    "product_name",
    "proteins_100g",
    "status",
  ]);
  assert.deepEqual(
    [...readPropertyNames(usdaFoodSchema, usdaSearchSchema)].sort(),
    [
      "amount",
      "brandName",
      "brandOwner",
      "dataType",
      "description",
      "fdcId",
      "foodNutrients",
      "foods",
      "gtinUpc",
      "id",
      "nutrient",
      "nutrientId",
      "servingSizeUnit",
      "unitName",
      "value",
    ],
  );
});

function propertyDiff(property: string) {
  return {
    paths: {
      modified: {
        "/api/v2/product/{barcode}": {
          operations: {
            modified: {
              GET: {
                responses: {
                  modified: {
                    "200": {
                      content: {
                        modified: {
                          "application/json": {
                            schema: {
                              properties: {
                                modified: {
                                  nutriments: {
                                    properties: {
                                      modified: {
                                        [property]: {
                                          type: {
                                            added: ["string"],
                                            deleted: ["number"],
                                          },
                                        },
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

test("oasdiff drops unread fields on matched paths and keeps read fields", async () => {
  const names = readPropertyNames(productResponseSchema);
  assert.deepEqual(filterReadChanges({}, names), []);
  assert.deepEqual(filterReadChanges(propertyDiff("unused"), names), []);
  assert.ok(
    filterReadChanges(propertyDiff("energy-kcal_100g"), names).length > 0,
  );
  assert.ok(
    filterReadChanges(
      { properties: { deleted: ["code", "unused"] } },
      names,
    )[0]?.endsWith("code"),
  );
  assert.deepEqual(
    filterReadChanges({ required: { added: ["unused"] } }, names),
    [],
  );
  const results = await runChecks(
    fixture({ diff: propertyDiff("unused") }).options,
  );
  assert.equal(results.off.docs.status, "pass");
  assert.equal(report(results, "run").outputs.off_drift, "false");
  const changed = await runChecks(
    fixture({ diff: propertyDiff("code") }).options,
  );
  assert.equal(changed.off.docs.status, "drift");
  assert.match(report(changed, "run").outputs.off_body ?? "", /code/);
});

test("malformed JSON is drift; malformed diff output is unavailable", async () => {
  const { options } = fixture();
  options.fetch = async () => new Response("{");
  options.runOasdiff = async () => null;
  const results = await runChecks(options);
  assert.equal(results.off.live.status, "drift");
  assert.equal(results.usda.live.status, "drift");
  assert.equal(results.off.docs.status, "unavailable");
});

test("unchanged USDA hash passes and a changed hash reports the spec URL", async () => {
  const unchanged = await runChecks(fixture().options);
  assert.equal(unchanged.usda.docs.status, "pass");
  const changed = await runChecks(fixture({ spec: "changed" }).options);
  assert.equal(changed.usda.docs.status, "drift");
  assert.match(
    changed.usda.docs.details.join(),
    /USDA spec changed: https:\/\/fdc.nal.usda.gov/,
  );
});
