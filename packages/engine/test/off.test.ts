import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkRecord } from "@tare/nutrition";
import {
  createOffAdapter,
  normalizeBarcode,
  type OffResult,
} from "../src/sources/off.ts";
import { test } from "./support/hang-ceiling.ts";

const userAgent = "Tare/1.0 (support@example.com)";
const code = "3017624010701";
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/off/${name}.json`, import.meta.url),
      "utf8",
    ),
  ).response;
const product = fixture("product");
const beverage = fixture("beverage");
const search = fixture("search");

function network(
  payload: unknown = product,
  status = 200,
  headers?: HeadersInit,
) {
  const requests: { url: URL; init: RequestInit | undefined }[] = [];
  const fetchResponse: typeof fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    return Response.json(payload, { status, headers });
  };
  return { requests, fetchResponse };
}

function records(result: OffResult) {
  assert.equal(result.status, "ok");
  assert.ok(result.status === "ok");
  return result.records;
}

test("recorded barcode lookup sends User-Agent and fields and preserves label values and unknown fiber", async () => {
  const peer = network();
  const adapter = createOffAdapter({ userAgent, fetch: peer.fetchResponse });
  const [record] = records(await adapter.lookupBarcode(code));
  assert.ok(record);
  assert.deepEqual(record, {
    source: "off",
    sourceId: code,
    name: "Nutella",
    brand: "Ferrero",
    barcode: code,
    labelSource: `https://world.openfoodfacts.org/product/${code}`,
    retrievedAt: record.retrievedAt,
    mealKit: null,
    basis: { dimension: "mass", amount: 100, unit: "g" },
    nutrients: {
      kcal: { amount: 539, provenance: "label" },
      protein_g: { amount: 6.3, provenance: "label" },
      carbs_g: { amount: 57.5, provenance: "label" },
      fat_g: { amount: 30.9, provenance: "label" },
      fiber_g: null,
    },
  });
  assert.deepEqual(checkRecord(record), []);
  assert.match(
    record.retrievedAt ?? "",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
  const [request] = peer.requests;
  assert.ok(request);
  assert.equal(request.url.pathname, `/api/v2/product/${code}.json`);
  assert.equal(
    request.url.searchParams.get("fields"),
    "code,product_name,brands,nutrition_data_per,nutriments",
  );
  assert.equal(new Headers(request.init?.headers).get("User-Agent"), userAgent);
});

test("leading-zero UPC-A and EAN-13 look up the same recorded beverage with a volume basis and known zero", async () => {
  const peer = network(beverage);
  const adapter = createOffAdapter({ userAgent, fetch: peer.fetchResponse });
  for (const barcode of ["049000028911", "0049000028911"]) {
    const [record] = records(await adapter.lookupBarcode(barcode));
    assert.ok(record);
    assert.equal(record.barcode, "0049000028911");
    assert.equal(record.sourceId, "0049000028911");
    assert.deepEqual(record.basis, {
      dimension: "volume",
      amount: 100,
      unit: "ml",
    });
    assert.deepEqual(record.nutrients.kcal, { amount: 0, provenance: "label" });
  }
  assert.equal(peer.requests[0]?.url.href, peer.requests[1]?.url.href);
});

test("barcode normalization is idempotent and UPC-A equals its zero-padded EAN-13", () => {
  for (let index = 0; index < 1000; index += 1) {
    const upc = String(index * 982451653).padStart(12, "0");
    const normalized = normalizeBarcode(upc);
    assert.equal(normalized, `0${upc}`);
    assert.equal(normalizeBarcode(normalized), normalized);
  }
  for (const barcode of ["12345678", "1234567890123", "00123456789012"])
    assert.equal(normalizeBarcode(barcode), barcode);
  for (const barcode of ["", "123", " 049000028911", "04900002891x"])
    assert.throws(() => normalizeBarcode(barcode), /Invalid barcode/);
});

test("explicit recorded name search runs once, sends User-Agent and returns only exact name and optional brand matches", async () => {
  const peer = network(search);
  const adapter = createOffAdapter({ userAgent, fetch: peer.fetchResponse });
  const matches = records(await adapter.searchName(" NUTELLA "));
  assert.deepEqual(
    matches.map((record) => record.sourceId),
    [
      "3017620422003",
      "3017620425035",
      "3017620429484",
      "80176800",
      "59032823",
      "8000500179864",
      "8000500082379",
    ],
  );
  assert.ok(
    matches.every(
      (record) =>
        checkRecord(record).length === 0 && record.basis?.unit === "g",
    ),
  );
  assert.equal(peer.requests.length, 1);
  assert.equal(
    peer.requests[0]?.url.searchParams.get("search_terms"),
    " NUTELLA ",
  );
  assert.equal(
    new Headers(peer.requests[0]?.init?.headers).get("User-Agent"),
    userAgent,
  );
  assert.deepEqual(
    records(await adapter.searchName("nutella", " ferrero ")).map(
      (record) => record.sourceId,
    ),
    ["80176800", "8000500179864"],
  );
  assert.deepEqual(
    records(await adapter.searchName("nutella", "different brand")),
    [],
  );
  assert.deepEqual(records(await adapter.searchName("Nutella spread")), []);
});

test("unconfigured and invalid requests make no network call", async () => {
  const peer = network();
  for (const value of [undefined, "", " "]) {
    const adapter = createOffAdapter({
      userAgent: value,
      fetch: peer.fetchResponse,
    });
    assert.deepEqual(await adapter.lookupBarcode(code), {
      status: "unconfigured",
    });
    assert.deepEqual(await adapter.searchName("Nutella"), {
      status: "unconfigured",
    });
  }
  const adapter = createOffAdapter({ userAgent, fetch: peer.fetchResponse });
  assert.deepEqual(await adapter.lookupBarcode("not-a-code"), {
    status: "invalid_input",
  });
  assert.deepEqual(await adapter.searchName(" "), { status: "invalid_input" });
  assert.equal(peer.requests.length, 0);
});

test("missing products, empty searches and invalid records return no match without inventing a basis or nutrient", async () => {
  for (const payload of [
    { status: 0 },
    {
      status: 1,
      product: { ...product.product, nutrition_data_per: undefined },
    },
    {
      status: 1,
      product: { ...product.product, nutrition_data_per: "serving" },
    },
    { status: 1, product: { ...product.product, nutriments: {} } },
    {
      status: 1,
      product: { ...product.product, nutriments: { "energy-kcal_100g": -1 } },
    },
    { status: 1, product: { ...product.product, product_name: "" } },
    { status: 1, product: { ...product.product, code: "1234567890123" } },
  ]) {
    const peer = network(payload);
    assert.deepEqual(
      records(
        await createOffAdapter({
          userAgent,
          fetch: peer.fetchResponse,
        }).lookupBarcode(code),
      ),
      [],
    );
  }
  const peer = network({ products: [] });
  assert.deepEqual(
    records(
      await createOffAdapter({
        userAgent,
        fetch: peer.fetchResponse,
      }).searchName("Nutella"),
    ),
    [],
  );
  const missing = network({ status: 0 }, 404);
  assert.deepEqual(
    records(
      await createOffAdapter({
        userAgent,
        fetch: missing.fetchResponse,
      }).lookupBarcode(code),
    ),
    [],
  );
});

test("network, HTTP and malformed responses are unavailable rather than a successful miss", async () => {
  const broken: typeof fetch = async () => {
    throw new Error("offline");
  };
  assert.deepEqual(
    await createOffAdapter({ userAgent, fetch: broken }).lookupBarcode(code),
    { status: "unavailable", reason: "network" },
  );
  const server = network({}, 503);
  assert.deepEqual(
    await createOffAdapter({
      userAgent,
      fetch: server.fetchResponse,
    }).lookupBarcode(code),
    { status: "unavailable", reason: "http", httpStatus: 503 },
  );
  for (const payload of [null, {}, [], { status: 1 }]) {
    const peer = network(payload);
    assert.deepEqual(
      await createOffAdapter({
        userAgent,
        fetch: peer.fetchResponse,
      }).lookupBarcode(code),
      { status: "unavailable", reason: "invalid_response" },
    );
  }
  const malformed: typeof fetch = async () => new Response("not JSON");
  assert.deepEqual(
    await createOffAdapter({ userAgent, fetch: malformed }).searchName(
      "Nutella",
    ),
    { status: "unavailable", reason: "invalid_response" },
  );
  const wrongShape = network({ products: null });
  assert.deepEqual(
    await createOffAdapter({
      userAgent,
      fetch: wrongShape.fetchResponse,
    }).searchName("Nutella"),
    { status: "unavailable", reason: "invalid_response" },
  );
});

test("over-limit product reads and the eleventh search make no request, including concurrent calls, then reset", async (context) => {
  context.mock.timers.enable({
    apis: ["Date", "setTimeout"],
    now: Date.parse("2026-01-01T00:00:00Z"),
  });
  const peer = network({ ...product, products: search.products });
  const adapter = createOffAdapter({ userAgent, fetch: peer.fetchResponse });
  const productResults = await Promise.all(
    Array.from({ length: 101 }, () => adapter.lookupBarcode(code)),
  );
  assert.equal(
    productResults.filter((result) => result.status === "ok").length,
    100,
  );
  assert.deepEqual(productResults[100], {
    status: "rate_limited",
    retryAfterMs: 60_000,
  });
  assert.equal(peer.requests.length, 100);
  const searchResults = await Promise.all(
    Array.from({ length: 11 }, () => adapter.searchName("Nutella")),
  );
  assert.equal(
    searchResults.filter((result) => result.status === "ok").length,
    10,
  );
  assert.deepEqual(searchResults[10], {
    status: "rate_limited",
    retryAfterMs: 60_000,
  });
  assert.equal(peer.requests.length, 110);
  context.mock.timers.tick(59_999);
  assert.deepEqual(await adapter.lookupBarcode(code), {
    status: "rate_limited",
    retryAfterMs: 1,
  });
  assert.deepEqual(await adapter.searchName("Nutella"), {
    status: "rate_limited",
    retryAfterMs: 1,
  });
  assert.equal(peer.requests.length, 110);
  context.mock.timers.tick(1);
  assert.equal((await adapter.lookupBarcode(code)).status, "ok");
  assert.equal((await adapter.searchName("Nutella")).status, "ok");
  assert.equal(peer.requests.length, 112);
});

test("stepped request sequences never exceed 100 product reads or 10 searches in each limiter minute", async (context) => {
  context.mock.timers.enable({
    apis: ["Date", "setTimeout"],
    now: Date.parse("2026-01-01T00:00:00Z"),
  });
  const peer = network({ ...product, products: [] });
  const adapter = createOffAdapter({ userAgent, fetch: peer.fetchResponse });
  let seed = 111;
  for (let minute = 0; minute < 6; minute += 1) {
    await adapter.lookupBarcode(code);
    await adapter.searchName("Nutella");
    const counts = { product: 1, search: 1 };
    for (let step = 0; step < 240; step += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const kind = seed % 4 === 0 ? "search" : "product";
      const before = peer.requests.length;
      const result =
        kind === "product"
          ? await adapter.lookupBarcode(code)
          : await adapter.searchName("Nutella");
      const limit = kind === "product" ? 100 : 10;
      assert.equal(result.status, counts[kind] < limit ? "ok" : "rate_limited");
      assert.equal(peer.requests.length - before, counts[kind] < limit ? 1 : 0);
      if (result.status === "ok") counts[kind] += 1;
      context.mock.timers.tick(200);
    }
    assert.deepEqual(counts, { product: 100, search: 10 });
    context.mock.timers.tick(12_000);
  }
  assert.equal(peer.requests.length, 660);
});

test("429 backs off for Retry-After seconds, HTTP dates or a minute fallback without retrying", async (context) => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  for (const header of [
    "120",
    new Date(now + 120_000).toUTCString(),
    "bad",
    undefined,
  ]) {
    const peer = network(
      {},
      429,
      header ? { "Retry-After": header } : undefined,
    );
    const adapter = createOffAdapter({ userAgent, fetch: peer.fetchResponse });
    const delay =
      header === "120" || header?.includes("GMT") ? 120_000 : 60_000;
    assert.deepEqual(await adapter.lookupBarcode(code), {
      status: "rate_limited",
      retryAfterMs: delay,
    });
    assert.equal(peer.requests.length, 1);
    context.mock.timers.tick(delay - 1);
    assert.deepEqual(await adapter.lookupBarcode(code), {
      status: "rate_limited",
      retryAfterMs: 1,
    });
    assert.equal(peer.requests.length, 1);
    context.mock.timers.tick(1);
    assert.equal((await adapter.lookupBarcode(code)).status, "rate_limited");
    assert.equal(peer.requests.length, 2);
    context.mock.timers.setTime(now);
  }
});
