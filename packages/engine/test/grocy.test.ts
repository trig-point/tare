import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { z } from "zod";
import {
  loadConfig,
  loadStartupConfig,
  reportStartupError,
} from "../src/config.ts";
import { openDatabase } from "../src/db.ts";
import {
  createGrocyClient,
  grocyStockSchema,
  type grocyUnitSchema,
} from "../src/grocy/client.ts";
import { normalizeGrocyUrl, resolveGrocyOwner } from "../src/grocy/config.ts";
import { test } from "./support/hang-ceiling.ts";

const settings = {
  DATABASE_URL: ":memory:",
  TARE_GROCY_URL: " http://grocy/api/ ",
  TARE_GROCY_API_KEY: " synthetic-key ",
  TARE_GROCY_USERNAME: " example-alex ",
};
const config =
  loadConfig(settings).grocy ?? assert.fail("Missing fixture configuration");
const bookings = [
  { id: "7", transaction_id: "example-transaction" },
  { id: 8, transaction_id: "example-transaction" },
];
const stockRow: z.input<typeof grocyStockSchema>[number] = {
  product_id: 1,
  amount: 2.5,
  best_before_date: "2027-12-31",
  product: {
    id: 1,
    name: "Synthetic rice",
    qu_id_stock: 4,
    enable_tare_weight_handling: 0,
  },
};

test("Grocy config is optional, normalized, owner-scoped and safe at startup", () => {
  assert.equal(loadConfig({ DATABASE_URL: ":memory:" }).grocy, null);
  assert.equal(config?.url, "http://grocy/api");
  assert.throws(() => normalizeGrocyUrl("grocy"), /TARE_GROCY_URL/);
  for (const field of [
    "TARE_GROCY_URL",
    "TARE_GROCY_API_KEY",
    "TARE_GROCY_USERNAME",
  ])
    assert.throws(() => loadConfig({ ...settings, [field]: " " }));
  for (const url of [
    "http://example.com",
    "https://grocy/api/../api",
    "https://grocy/%61pi",
    "https://grocy/api?",
    "https://grocy/#",
    "https://user:pass@grocy",
    "https://grocy/api%2f",
    "https://grocy\\api",
    "http://[fc::1]",
    "http://[fd1::1]",
    "http://[fe8::1]",
    "http://134744072/",
    "http://0x08080808/",
  ])
    assert.throws(() => normalizeGrocyUrl(url));
  for (const host of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.1.2",
    "192.168.1.2",
    "[::1]",
    "[fd00::1]",
    "[fe80::1]",
  ])
    assert.equal(normalizeGrocyUrl(`http://${host}/`), `http://${host}/api`);
  const connection = openDatabase(":memory:");
  try {
    assert.equal(resolveGrocyOwner(connection.database, null), null);
    assert.throws(() => resolveGrocyOwner(connection.database, config));
    connection.database.exec(
      "INSERT INTO users (username, timezone, created_at) VALUES ('example-alex', 'UTC', '2026-01-01T00:00:00.000Z')",
    );
    assert.equal(resolveGrocyOwner(connection.database, config), 1);
  } finally {
    connection.close();
  }
  const logs: string[] = [];
  assert.equal(
    loadStartupConfig(
      { ...settings, DATABASE_URL: "", TARE_GROCY_API_KEY: "DATABASE_URL" },
      (message) => logs.push(message),
    ),
    undefined,
  );
  reportStartupError(
    new Error("synthetic-key upstream URL and body"),
    "synthetic-key",
    (message) => logs.push(message),
  );
  reportStartupError(new Error("Grocy operation failed"), "Grocy", (message) =>
    logs.push(message),
  );
  reportStartupError(new Error("Safe startup error"), undefined, (message) =>
    logs.push(message),
  );
  assert.deepEqual(logs, [
    "Grocy operation failed",
    "Grocy operation failed",
    "Safe startup error",
  ]);
});

test("Grocy reads validate whole responses and preserve native numeric and barcode values", async () => {
  let response: unknown = [];
  const paths: string[] = [];
  const client = createGrocyClient({
    config,
    ownerId: 1,
    fetch: async (url, init) => {
      paths.push(String(url));
      assert.equal(init?.redirect, "manual");
      assert.equal(
        (init?.headers as Record<string, string>)["GROCY-API-KEY"],
        "synthetic-key",
      );
      return response instanceof Response ? response : Response.json(response);
    },
  });
  assert.deepEqual(await client.stock(1), { status: "ok", value: [] });
  for (const amount of [null, "", true, "NaN", "Infinity"])
    assert.equal(
      grocyStockSchema.safeParse([{ ...stockRow, amount }]).success,
      false,
    );
  response = [
    {
      ...stockRow,
      product_id: "1",
      amount: " 2.5 ",
      product: { ...stockRow.product, qu_id_stock: "4", ignored: true },
    },
  ];
  const stock = await client.stock(1);
  assert.equal(stock?.status === "ok" && stock.value[0]?.amount, 2.5);
  const nullableUnit: z.input<typeof grocyUnitSchema> = {
    id: 6,
    name: "Synthetic measure",
    name_plural: null,
  };
  response = [nullableUnit];
  assert.deepEqual(await client.units(1), { status: "ok", value: response });
  response = {
    product: { ...stockRow.product, qu_id_stock: 6 },
    quantity_unit_stock: nullableUnit,
  };
  assert.equal((await client.product(1, 1))?.status, "ok");
  response = {};
  assert.equal((await client.product(1, 1))?.status, "failed");
  response = new Response("", { status: 401 });
  assert.deepEqual(await client.stock(1), {
    status: "failed",
    reason: "unauthorized",
    httpStatus: 401,
  });
  response = {};
  await client.barcode(1, "001/23?x");
  assert.equal(
    paths.at(-1),
    "http://grocy/api/stock/products/by-barcode/001%2F23%3Fx",
  );
  const count = paths.length;
  for (const productId of [0, -1, 1.5, Number.NaN])
    assert.equal((await client.consume(1, productId, 1))?.status, "not_sent");
  for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
    assert.equal((await client.consume(1, 1, amount))?.status, "not_sent");
  assert.deepEqual(await client.consume(2, 1, 1), {
    status: "not_sent",
    reason: "not_owner",
  });
  assert.equal(paths.length, count);
  assert.deepEqual(
    await createGrocyClient({ config: null, ownerId: null }).consume(1, 1, 1),
    { status: "not_sent", reason: "disabled" },
  );
});

test("Grocy consumes classify HTTP, lost response and bounded body outcomes without retries", async (context) => {
  let mode = "success";
  let cancelBody: (() => void) | undefined;
  const posts: unknown[] = [];
  const server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk);
    posts.push(JSON.parse(Buffer.concat(chunks).toString()));
    if (mode === "reset") {
      incoming.socket.destroy();
      return;
    }
    if (mode === "cancel") {
      outgoing.writeHead(200);
      outgoing.write("[");
      cancelBody = () => outgoing.destroy();
      return;
    }
    const responses: Record<string, [number, string]> = {
      success: [200, JSON.stringify(bookings)],
      empty: [200, "[]"],
      blank: [200, ""],
      malformed: [200, "{"],
      invalid: [200, JSON.stringify([...bookings, {}])],
      overflow: [200, "x".repeat(1_000_001)],
    };
    const [status, body] = responses[mode] ?? [
      Number(mode.split("-")[0]),
      mode === "401"
        ? ""
        : mode.endsWith("invalid")
          ? "{}"
          : JSON.stringify({
              error_message: "synthetic-key upstream-private-body",
            }),
    ];
    outgoing.writeHead(Number(status), { Location: "/redirected" });
    outgoing.end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const client = createGrocyClient({
    config: { ...config, url: `http://127.0.0.1:${address.port}/api` },
    ownerId: 1,
    fetch: async (url, init) => {
      const response = await fetch(url, init);
      if (mode === "cancel") {
        assert.ok(cancelBody);
        cancelBody();
      }
      return response;
    },
  });
  for (const [next, expected] of [
    ["success", "confirmed"],
    ["400", "rejected"],
    ["421", "rejected"],
    ["401", "uncertain"],
    ["403", "rejected"],
    ["404", "rejected"],
    ["403-invalid", "uncertain"],
    ["404-invalid", "uncertain"],
    ["302", "uncertain"],
    ["500", "uncertain"],
    ["empty", "uncertain"],
    ["blank", "uncertain"],
    ["malformed", "uncertain"],
    ["invalid", "uncertain"],
    ["reset", "uncertain"],
    ["cancel", "uncertain"],
    ["overflow", "uncertain"],
  ] as const) {
    mode = next;
    const before = posts.length;
    const result = await client.consume(1, 1, 0.25);
    assert.equal(result?.status, expected, mode);
    if (mode === "cancel") {
      assert.ok(result && "reason" in result);
      assert.equal(result.reason, "transport");
    }
    assert.equal(posts.length, before + 1);
    assert.deepEqual(posts.at(-1), {
      amount: 0.25,
      transaction_type: "consume",
      exact_amount: true,
      allow_subproduct_substitution: false,
    });
    if (result?.status === "confirmed")
      assert.deepEqual(result.value, [
        { id: 7, transaction_id: "example-transaction" },
        { id: 8, transaction_id: "example-transaction" },
      ]);
    else
      assert.doesNotMatch(
        JSON.stringify(result),
        /synthetic-key|upstream-private-body/,
      );
  }
});

test("Grocy deadline covers body reading and final errors refuse key collisions", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const client = createGrocyClient({
    config,
    ownerId: 1,
    fetch: async (_url, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener(
              "abort",
              () => controller.error(new Error("synthetic-key")),
              { once: true },
            );
            started();
          },
        }),
      ),
  });
  const pending = client.consume(1, 1, 0.25);
  await reading;
  context.mock.timers.tick(30_000);
  assert.deepEqual(await pending, { status: "uncertain", reason: "timeout" });
  for (const [apiKey, expected] of [
    ["unauthorized", { status: "uncertain", reason: "transport" }],
    ["uncertain", undefined],
  ]) {
    const collision = createGrocyClient({
      config: { ...config, apiKey: String(apiKey) },
      ownerId: 1,
      fetch: async () => new Response("{}", { status: 401 }),
    });
    assert.deepEqual(await collision.consume(1, 1, 1), expected);
  }
});
