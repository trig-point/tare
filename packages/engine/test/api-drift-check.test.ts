import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  filterReadChanges,
  offReadEndpoints,
  readPropertyPaths,
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
  foodNutrients: [{ nutrientId: 1008, unitName: "KCAL", value: 432 }],
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

const productEndpoint = "/api/v2/product/{code}";
const searchEndpoint = "/cgi/search.pl";

function schemaAt(path: string[], leaf: unknown): unknown {
  const [segment, ...rest] = path;
  if (segment === undefined) return leaf;
  if (segment === "[]") return { items: schemaAt(rest, leaf) };
  return { properties: { modified: { [segment]: schemaAt(rest, leaf) } } };
}

const typeChange = { type: { added: ["integer"], deleted: ["string"] } };

function endpointDiff(
  endpoint: string,
  get: unknown,
  extra: Record<string, unknown> = {},
) {
  return {
    paths: {
      modified: { [endpoint]: { operations: { modified: { GET: get } } } },
    },
    ...extra,
  };
}

function schemaDiff(endpoint: string, schema: unknown) {
  return endpointDiff(endpoint, {
    responses: {
      modified: {
        "200": {
          content: { modified: { "application/json": { schema } } },
        },
      },
    },
  });
}

function composed(keyword: string, diff: unknown) {
  return {
    [keyword]: {
      modified: [{ base: { index: 0 }, revision: { index: 0 }, diff }],
    },
  };
}

async function docsStatus(diff: unknown) {
  return (await runChecks(fixture({ diff }).options)).off.docs;
}

test("schema shape walk returns read paths through unions, arrays, optional, nullable and catch", () => {
  assert.deepEqual([...readPropertyPaths(productResponseSchema)].sort(), [
    "product",
    "product.brands",
    "product.code",
    "product.nutriments",
    "product.nutriments.carbohydrates_100g",
    "product.nutriments.energy-kcal_100g",
    "product.nutriments.fat_100g",
    "product.nutriments.fiber_100g",
    "product.nutriments.proteins_100g",
    "product.nutrition_data_per",
    "product.product_name",
    "status",
  ]);
  assert.deepEqual(
    [...readPropertyPaths(usdaFoodSchema, usdaSearchSchema)].sort(),
    [
      "brandName",
      "brandOwner",
      "dataType",
      "description",
      "fdcId",
      "foodNutrients",
      "foodNutrients[]",
      "foodNutrients[].amount",
      "foodNutrients[].nutrient",
      "foodNutrients[].nutrient.id",
      "foodNutrients[].nutrient.unitName",
      "foodNutrients[].nutrientId",
      "foodNutrients[].unitName",
      "foodNutrients[].value",
      "foods",
      "foods[]",
      "gtinUpc",
      "servingSizeUnit",
    ],
  );
  const search = offReadEndpoints.find(({ match }) =>
    match.test("/cgi/search.pl"),
  );
  assert.ok(search?.paths.has("products[].code"));
  assert.ok(search?.paths.has("products[].nutriments.energy-kcal_100g"));
  assert.equal(search?.paths.has("products[].status"), false);
});

test("oasdiff drops unread fields on matched paths and keeps read fields", async () => {
  assert.deepEqual(filterReadChanges({}, offReadEndpoints), []);
  assert.deepEqual(
    filterReadChanges(
      schemaDiff(productEndpoint, schemaAt(["product", "unused"], typeChange)),
      offReadEndpoints,
    ),
    [],
  );
  assert.ok(
    filterReadChanges(
      schemaDiff(
        productEndpoint,
        schemaAt(["product", "nutriments", "energy-kcal_100g"], typeChange),
      ),
      offReadEndpoints,
    ).length > 0,
  );
  assert.deepEqual(
    filterReadChanges(
      schemaDiff(
        productEndpoint,
        schemaAt(["product"], { properties: { deleted: ["code", "unused"] } }),
      ),
      offReadEndpoints,
    ),
    ["/api/v2/product/{code} product.code: properties deleted"],
  );
  assert.deepEqual(
    filterReadChanges(
      schemaDiff(
        productEndpoint,
        schemaAt(["product"], { required: { added: ["unused"] } }),
      ),
      offReadEndpoints,
    ),
    [],
  );
  const results = await runChecks(
    fixture({
      diff: schemaDiff(
        productEndpoint,
        schemaAt(["product", "unused"], typeChange),
      ),
    }).options,
  );
  assert.equal(results.off.docs.status, "pass");
  assert.equal(report(results, "run").outputs.off_drift, "false");
  const changed = await runChecks(
    fixture({
      diff: schemaDiff(
        productEndpoint,
        schemaAt(["product", "code"], typeChange),
      ),
    }).options,
  );
  assert.equal(changed.off.docs.status, "drift");
  assert.match(report(changed, "run").outputs.off_body ?? "", /product\.code/);
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

test("oasdiff drops a read field name under a parent the adapters never read", async () => {
  for (const diff of [
    schemaDiff(
      productEndpoint,
      schemaAt(["product", "ecoscore", "code"], typeChange),
    ),
    schemaDiff(
      searchEndpoint,
      schemaAt(["products", "[]", "ecoscore", "code"], typeChange),
    ),
    schemaDiff(productEndpoint, schemaAt(["code"], typeChange)),
    {
      components: {
        schemas: {
          modified: { Product: schemaAt(["product", "code"], typeChange) },
        },
      },
    },
  ]) {
    const result = await docsStatus(diff);
    assert.equal(result.status, "pass", result.details.join());
  }
});

test("oasdiff keeps read paths inside oneOf, allOf and search products items", async () => {
  const nested = await docsStatus(
    schemaDiff(
      productEndpoint,
      composed(
        "oneOf",
        composed("allOf", schemaAt(["product", "code"], typeChange)),
      ),
    ),
  );
  assert.equal(nested.status, "drift");
  assert.match(nested.details.join(), /product\.code/);
  const search = await docsStatus(
    schemaDiff(
      searchEndpoint,
      schemaAt(["products", "[]", "code"], typeChange),
    ),
  );
  assert.equal(search.status, "drift");
  assert.match(search.details.join(), /products\[\]\.code/);
  const nutrient = await docsStatus(
    schemaDiff(
      productEndpoint,
      schemaAt(["product", "nutriments", "energy-kcal_100g"], typeChange),
    ),
  );
  assert.equal(nutrient.status, "drift");
  for (const [required, status] of [
    [{ added: ["ecoscore"] }, "pass"],
    [{ deleted: ["code"] }, "drift"],
  ] as const) {
    const result = await docsStatus(
      schemaDiff(searchEndpoint, schemaAt(["products", "[]"], { required })),
    );
    assert.equal(result.status, status, JSON.stringify(required));
  }
});

test("oasdiff keeps removed endpoints, responses and subschemas the adapters read", async () => {
  for (const [diff, status] of [
    [{ paths: { deleted: [productEndpoint] } }, "drift"],
    [
      endpointDiff(productEndpoint, { responses: { deleted: ["200"] } }),
      "drift",
    ],
    [endpointDiff(productEndpoint, { responses: { added: ["404"] } }), "pass"],
    [
      endpointDiff(productEndpoint, {
        parameters: {
          modified: { query: { fields: { required: { to: true } } } },
        },
      }),
      "pass",
    ],
    [
      schemaDiff(productEndpoint, { oneOf: { deleted: [{ index: 1 }] } }),
      "drift",
    ],
    [
      schemaDiff(
        productEndpoint,
        schemaAt(["product", "ecoscore"], {
          allOf: { deleted: [{ index: 0 }] },
        }),
      ),
      "pass",
    ],
  ] as const) {
    const result = await docsStatus(diff);
    assert.equal(result.status, status, JSON.stringify(diff));
  }
});

// Captured verbatim from the checksum-verified oasdiff 1.35.0 release binary,
// diffing small synthetic specs, so these pin the real output shape.
const capturedOasdiff = {
  nestedAndSearch: `{"paths":{"modified":{"/api/v2/product/{code}":{"operations":{"modified":{"GET":{"responses":{"modified":{"200":{"content":{"modified":{"application/json":{"schema":{"oneOf":{"modified":[{"base":{"index":0,"component":"Resp"},"revision":{"index":0,"component":"Resp"},"diff":{"properties":{"modified":{"product":{"properties":{"modified":{"ecoscore":{"properties":{"modified":{"code":{"type":{"added":["integer"],"deleted":["string"]}}}}}}}}}}}},{"base":{"index":1},"revision":{"index":1},"diff":{"allOf":{"modified":[{"base":{"index":1},"revision":{"index":1},"diff":{"properties":{"modified":{"product":{"properties":{"modified":{"code":{"type":{"added":["integer"],"deleted":["string"]}}}}}}}}}]}}}]}}}}}}}}}}}},"/cgi/search.pl":{"operations":{"modified":{"GET":{"responses":{"modified":{"200":{"content":{"modified":{"application/json":{"schema":{"properties":{"modified":{"products":{"items":{"required":{"added":["ecoscore"]},"properties":{"modified":{"ecoscore":{"properties":{"modified":{"code":{"type":{"added":["integer"],"deleted":["string"]}}}}}}}}}}}}}}}}}}}}}}}},"components":{"schemas":{"modified":{"Resp":{"properties":{"modified":{"product":{"properties":{"modified":{"ecoscore":{"properties":{"modified":{"code":{"type":{"added":["integer"],"deleted":["string"]}}}}}}}}}}}}}}}`,
  removals: `{"paths":{"deleted":["/cgi/search.pl"],"modified":{"/api/v2/product/{code}":{"operations":{"modified":{"GET":{"responses":{"modified":{"200":{"content":{"modified":{"application/json":{"schema":{"oneOf":{"modified":[{"base":{"index":0,"component":"Resp"},"revision":{"index":0,"component":"Resp"},"diff":{"properties":{"modified":{"product":{"properties":{"added":["brands"],"deleted":["code"]}}}}}},{"base":{"index":1},"revision":{"index":1},"diff":{"allOf":{"deleted":[{"index":0}]}}}]}}}}}}}}}}}}}},"components":{"schemas":{"modified":{"Resp":{"properties":{"modified":{"product":{"properties":{"added":["brands"],"deleted":["code"]}}}}}}}}}`,
  rootRefactor: `{"paths":{"modified":{"/api/v2/product/{code}":{"operations":{"modified":{"GET":{"responses":{"modified":{"200":{"content":{"modified":{"application/json":{"schema":{"allOf":{"deleted":[{"index":0}]},"type":{"added":["object"]},"description":{"from":"old","to":"new"},"properties":{"added":["product"]}}}}}}}}}}}}}}}`,
  schemaDeleted: `{"paths":{"modified":{"/api/v2/product/{code}":{"operations":{"modified":{"GET":{"responses":{"modified":{"200":{"content":{"modified":{"application/json":{"schema":{"schemaDeleted":true}}}}}}}}}}}}}}`,
  annotations: `{"paths":{"modified":{"/api/v2/product/{code}":{"operations":{"modified":{"GET":{"responses":{"modified":{"200":{"content":{"modified":{"application/json":{"schema":{"allOf":{"modified":[{"base":{"index":0},"revision":{"index":0},"diff":{"properties":{"modified":{"product":{"description":{"from":"p old","to":"p new"},"patternProperties":{"modified":{"^x_":{"type":{"added":["integer"],"deleted":["string"]}}}}}}}}}]},"description":{"from":"old","to":"new"}}}}}}}}}}}}}}}`,
};

test("captured oasdiff output keeps read-path changes and drops unread and annotation edits", () => {
  const expected: Record<keyof typeof capturedOasdiff, string[]> = {
    nestedAndSearch: ["/api/v2/product/{code} product.code: type changed"],
    removals: [
      "/api/v2/product/{code} product.brands: properties added",
      "/api/v2/product/{code} product.code: properties deleted",
      "/api/v2/product/{code} response: allOf subschema deleted",
      "/cgi/search.pl: endpoint deleted",
    ],
    rootRefactor: [
      "/api/v2/product/{code} product: properties added",
      "/api/v2/product/{code} response: allOf subschema deleted",
      "/api/v2/product/{code} response: type changed",
    ],
    schemaDeleted: ["/api/v2/product/{code} response: schemaDeleted changed"],
    annotations: ["/api/v2/product/{code} product: patternProperties changed"],
  };
  for (const [name, output] of Object.entries(capturedOasdiff))
    assert.deepEqual(
      filterReadChanges(JSON.parse(output), offReadEndpoints),
      expected[name as keyof typeof capturedOasdiff],
      name,
    );
});

test("OFF parse failures name fields without a leading dot", async () => {
  const results = await runChecks(
    fixture({ off: { status: 1, product: {} } }).options,
  );
  assert.deepEqual(results.off.live.details, [
    "Invalid response: status, product.code",
  ]);
});

test("USDA detail whose nutrients all fail to parse is drift", async () => {
  const results = await runChecks(
    fixture({ detail: { ...food, foodNutrients: [{ renamed: 1008 }] } })
      .options,
  );
  assert.equal(results.usda.live.status, "drift");
  assert.match(results.usda.live.details.join(), /food\.foodNutrients/);
});
