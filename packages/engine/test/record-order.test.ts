import assert from "node:assert/strict";
import { listMealsOnHand } from "../src/orders/index.ts";
import { selectPerson } from "../src/queries/select-person.ts";
import { accessFixture, mcpSession } from "./auth-support.ts";
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
  const setup = accessFixture(context);
  const client = await mcpSession(context, setup, setup.admin.id);
  const call = async (args: object) =>
    client.callTool({ name: "record_order", arguments: { ...args } });
  const rows = (sql: string) => setup.database.prepare(sql).all();
  const state = () =>
    ["orders", "order_meals", "questions", "inbound_emails"].map((table) =>
      rows(`SELECT * FROM ${table}`),
    );
  const person = selectPerson(setup.database, { id: setup.admin.id });
  assert.ok(person);
  const onHand = () =>
    listMealsOnHand(setup.database, person, "2026-01-05T12:00:00.000Z").map(
      (meal) => meal.quantity,
    );
  const empty = state();
  for (const input of [
    { ...order, meals: [] },
    { ...order, delivery_date: "2026-13-40" },
    { ...order, status: "delivered" },
  ])
    assert.equal((await call(input)).isError, true);
  assert.deepEqual(state(), empty);

  const first = (await call(order)).structuredContent as { order_id: number };
  const { order_id, ...outcome } = first;
  assert.deepEqual(outcome, { outcome: "reconciled", repeat: false });
  assert.equal(rows("SELECT kind FROM questions").length, 2);
  assert.deepEqual(onHand(), [2, 1]);
  const written = state();
  for (const meals of [order.meals, [...order.meals].reverse()]) {
    const repeat = await call({ ...order, meals });
    assert.deepEqual(repeat.structuredContent, { ...first, repeat: true });
  }
  assert.deepEqual(state(), written);

  await call({ ...order, status: "processed", meals: [order.meals[0]] });
  assert.deepEqual(rows("SELECT id, status FROM orders"), [
    { id: order_id, status: "processed" },
  ]);
  assert.deepEqual(onHand(), [2]);
});
