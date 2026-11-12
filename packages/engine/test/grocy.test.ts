import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import {
  loadConfig,
  loadStartupConfig,
  reportStartupError,
} from "../src/config.ts";
import { openDatabase } from "../src/db.ts";
import { createGrocyClient } from "../src/grocy/client.ts";
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
const booking = {
  id: 7,
  transaction_id: "example-transaction",
  product_id: 1,
  transaction_type: "consume",
  amount: -0.25,
};
const product = {
  id: 1,
  name: "Synthetic rice",
  qu_id_stock: 4,
  enable_tare_weight_handling: 0,
};

test("Grocy config is optional, normalized, owner-scoped and safe at startup", () => {
  assert.equal(loadConfig({ DATABASE_URL: ":memory:" }).grocy, null);
  assert.equal(config.url, "http://grocy/api");
  for (const field of [
    "TARE_GROCY_URL",
    "TARE_GROCY_API_KEY",
    "TARE_GROCY_USERNAME",
  ])
    assert.throws(() => loadConfig({ ...settings, [field]: " " }));
  for (const url of [
    "grocy",
    "http://example.com",
    "https://grocy/api/../api",
    "https://user:pass@grocy",
  ])
    assert.throws(() => normalizeGrocyUrl(url), /TARE_GROCY_URL/);
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
    loadStartupConfig({ ...settings, DATABASE_URL: "" }, (message) =>
      logs.push(message),
    ),
    undefined,
  );
  for (const [message, key] of [
    ["synthetic-key upstream URL and body", "synthetic-key"],
    ["Safe startup error", undefined],
  ])
    reportStartupError(new Error(message), key, (message) =>
      logs.push(message),
    );
  assert.deepEqual(logs, [
    "DATABASE_URL is required",
    "Grocy operation failed",
    "Safe startup error",
  ]);
});

test("Grocy reads validate responses and normalize native values; invalid consumes are not sent", async () => {
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
  response = [
    {
      product_id: "1",
      amount: " 2.5 ",
      best_before_date: "2027-12-31",
      product,
    },
  ];
  const stock = await client.stock(1);
  assert.equal(stock?.status === "ok" && stock.value[0]?.amount, 2.5);
  response = [{ id: 4, name: "Synthetic measure", name_plural: null }];
  assert.deepEqual(await client.units(1), { status: "ok", value: response });
  response = [
    { id: "3", name: "Synthetic oats", qu_id_stock: "4", active: "0" },
  ];
  assert.deepEqual(await client.catalog(1), {
    status: "ok",
    value: [{ id: 3, name: "Synthetic oats", qu_id_stock: 4, active: 0 }],
  });
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
  for (const [productId, amount] of [
    [0, 1],
    [1.5, 1],
    [1, 0],
    [1, Number.NaN],
  ] as const)
    assert.equal(
      (await client.consume(1, productId, amount))?.status,
      "not_sent",
    );
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

test("Grocy consumes classify outcomes without retries, including HTTP 421", async (context) => {
  const cases: [number, unknown, string][] = [
    [
      200,
      [
        { ...booking, amount: "-0.1" },
        { ...booking, id: 8, amount: -0.15 },
      ],
      "confirmed",
    ],
    [
      400,
      { error_message: "Product does not exist or is inactive" },
      "rejected",
    ],
    [
      400,
      {
        error_message:
          "Amount to be consumed cannot be > current stock amount (if supplied, at the desired location)",
      },
      "rejected",
    ],
    [400, { error_message: "Shopping list does not exist" }, "uncertain"],
    ...[401, 421, 302, 500].map((status): [number, unknown, string] => [
      status,
      { error_message: "synthetic-key upstream-private-body" },
      "uncertain",
    ]),
    ...[
      [{ ...booking, amount: -0.1 }],
      [{ ...booking, product_id: 2 }],
      [{ ...booking, transaction_type: "purchase" }],
      [booking, {}],
      [],
    ].map((body): [number, unknown, string] => [200, body, "uncertain"]),
    [200, "{", "uncertain"],
    [200, "x".repeat(1_000_001), "uncertain"],
    [0, "reset", "uncertain"],
  ];
  let current: (typeof cases)[number];
  const posts: unknown[] = [];
  const server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk);
    posts.push(JSON.parse(Buffer.concat(chunks).toString()));
    const [status, body] = current;
    if (body === "reset") {
      incoming.socket.destroy();
      return;
    }
    outgoing.writeHead(status, { Location: "/redirected" });
    outgoing.end(typeof body === "string" ? body : JSON.stringify(body));
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
  });
  for (const next of cases) {
    current = next;
    const before = posts.length;
    const result = await client.consume(1, 1, 0.25);
    assert.equal(
      result?.status,
      current[2],
      JSON.stringify(current.slice(0, 1)),
    );
    assert.equal(posts.length, before + 1);
    assert.deepEqual(posts.at(-1), {
      amount: 0.25,
      transaction_type: "consume",
      exact_amount: true,
      allow_subproduct_substitution: false,
    });
    if (result?.status === "confirmed")
      assert.deepEqual(result.value, [
        { ...booking, amount: -0.1 },
        { ...booking, id: 8, amount: -0.15 },
      ]);
    else
      assert.doesNotMatch(
        JSON.stringify(result),
        /synthetic-key|upstream-private-body/,
      );
  }
});

test("Grocy deadline covers body reading", async (context) => {
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
});
