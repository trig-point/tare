import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { listMealsOnHand } from "../src/orders/index.ts";
import { insertAgentToken } from "../src/queries/insert-agent-token.ts";
import { selectPerson } from "../src/queries/select-person.ts";
import {
  accessFixture,
  assertionHeader,
  signAccessToken,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";

const order = {
  service: "Example Kit",
  delivery_date: "2026-01-05",
  status: "scheduled",
  meals: [
    { name: "Example bowl", chef: "Example chef", quantity: 2 },
    { name: "Example curry", quantity: 1 },
  ],
};

test("record_order over MCP creates, repeats as a no-op, supersedes and rejects malformed input", async (context) => {
  const { app, database, admin } = accessFixture(context);
  insertAgentToken(database, {
    client_id: "example-agent",
    user_id: admin.id,
    name: "Example agent",
    created_at: "2026-01-01T00:00:00.000Z",
  });
  const token = await signAccessToken({
    sub: "",
    common_name: "example-agent",
  });
  const client = new Client({ name: "example", version: "1" });
  context.after(() => client.close());
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      fetch: async (url, init) => app.request(url.toString(), init),
      requestInit: { headers: assertionHeader(token) },
    }),
  );
  const call = async (args: object) =>
    client.callTool({ name: "record_order", arguments: { ...args } });
  const rows = (sql: string) => database.prepare(sql).all();
  const state = () =>
    ["orders", "order_meals", "questions", "inbound_emails"].map((table) =>
      rows(`SELECT * FROM ${table}`),
    );
  const before = state();
  for (const input of [
    { ...order, meals: [] },
    { ...order, delivery_date: "2026-13-40" },
    { ...order, status: "delivered" },
  ])
    assert.equal((await call(input)).isError, true);
  assert.deepEqual(state(), before);

  const first = (await call(order)).structuredContent as { order_id: number };
  assert.deepEqual(first, {
    order_id: first.order_id,
    outcome: "reconciled",
    repeat: false,
  });
  assert.deepEqual(rows("SELECT kind FROM questions"), [
    { kind: "meal_nutrition" },
    { kind: "meal_nutrition" },
  ]);
  const person = selectPerson(database, { id: admin.id });
  assert.ok(person);
  const onHand = (now: string) =>
    listMealsOnHand(database, person, now).map((meal) => meal.quantity);
  assert.deepEqual(onHand("2026-01-01T12:00:00.000Z"), []);
  assert.deepEqual(onHand("2026-01-05T12:00:00.000Z"), [2, 1]);

  const written = state();
  assert.deepEqual((await call(order)).structuredContent, {
    ...first,
    repeat: true,
  });
  assert.deepEqual(state(), written);
  const reversed = { ...order, meals: [...order.meals].reverse() };
  assert.deepEqual((await call(reversed)).structuredContent, {
    ...first,
    repeat: true,
  });
  assert.deepEqual(state(), written);

  await call({ ...order, status: "processed", meals: [order.meals[0]] });
  assert.deepEqual(rows("SELECT id, status FROM orders"), [
    { id: first.order_id, status: "processed" },
  ]);
  assert.deepEqual(onHand("2026-01-05T12:00:00.000Z"), [2]);
});
