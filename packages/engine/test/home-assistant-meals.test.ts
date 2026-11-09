import assert from "node:assert/strict";
import { personDayBounds } from "../src/calendar/time.ts";
import { writeTransaction } from "../src/db.ts";
import { createMealButtons } from "../src/home-assistant/meal-buttons.ts";
import { mealNutritionKinds } from "../src/meal-nutrition/index.ts";
import { createOrder } from "../src/orders/index.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

test("meal buttons follow due dates and presses, rejecting stale and foreign presses", async (context) => {
  let now = new Date("2026-01-01T12:00:00.000Z");
  const clock = { now: () => now };
  const { database, admin, member } = await twoUsers(context, "fallback");
  for (const [person, delivery_date] of [
    [admin, "2026-01-01"],
    [admin, "2026-01-03"],
    [admin, "2026-01-05"],
    [member, "2026-01-01"],
  ] as const) {
    const meal = { name: "Example bowl", chef: null, quantity: 2 };
    const input = { service: "Example", delivery_date, meals: [meal] };
    writeTransaction(database, (scope) =>
      createOrder(
        scope,
        person.user,
        { ...input, status: "scheduled" },
        mealNutritionKinds,
        now.toISOString(),
      ),
    );
    const { questions } = await (await person.request("/api/questions")).json();
    const answer = { kcal: 600, protein_g: 35, carbs_g: 60, fat_g: 20 };
    for (const { id } of questions)
      await person.request("/api/questions/answer", {
        method: "POST",
        body: JSON.stringify({ id, answer: { ...answer, source: "Label" } }),
      });
  }
  const rows = database
    .prepare("SELECT id, order_id FROM order_meals ORDER BY id")
    .all() as { id: number; order_id: number }[];
  const [due, later, marked, foreign] = rows.map((row) => row.id);
  const handlers = new Map<string, (payload: Buffer) => void>();
  const subscribe = (topic: string, handler: (payload: Buffer) => void) =>
    handlers.set(topic, handler);
  const { provider } = createMealButtons({
    database,
    clock,
    publisher: { refreshAll() {}, subscribe },
  });
  const read = () => provider(admin.user, { state: "unused" });
  const payloads = () =>
    Object.fromEntries(
      read().entities.map(({ key, config }) => [key, config.payload_press]),
    );
  const press = (payload: unknown) => {
    const [topic, handler] = [...handlers][0] ?? [];
    handler?.(Buffer.from(String(payload)));
    return JSON.parse(`${read().state[`${topic}_result`]}`).result;
  };
  const count = (sql: string) => database.prepare(sql).pluck().get();

  const first = payloads();
  assert.deepEqual(Object.keys(first).sort(), [
    `meal_${due}_ate`,
    `meal_${due}_ate_three_quarters`,
    "meal_press_result",
  ]);
  const ate = first[`meal_${due}_ate`];
  assert.deepEqual(JSON.parse(`${ate}`), {
    meal_id: due,
    revision: 1,
    action: "ate",
  });
  await admin.request("/api/orders/mark-delivery", {
    method: "POST",
    body: JSON.stringify({ order_id: rows[2]?.order_id }),
  });
  assert.ok(`meal_${marked}_ate` in payloads());
  const { timezone, day_start_hour } = admin.user;
  now = personDayBounds("2026-01-03", timezone, day_start_hour).start;
  assert.ok(`meal_${later}_ate` in payloads());

  assert.equal(press(ate), "logged");
  assert.equal(press(ate), "logged");
  const threeQuarters = first[`meal_${due}_ate_three_quarters`];
  assert.equal(press(threeQuarters), "stale_revision");
  const foreignPress = { meal_id: foreign, revision: 1, action: "ate" };
  assert.equal(press(JSON.stringify(foreignPress)), "meal_not_found");
  assert.equal(press("not json"), "invalid_press");
  assert.equal(press(payloads()[`meal_${due}_ate`]), "logged");
  assert.ok(!(`meal_${due}_ate` in payloads()));
  assert.equal(
    count("SELECT group_concat(quantity) FROM order_meals"),
    "0,2,2,2",
  );
  assert.equal(count("SELECT count(*) FROM intake_entries"), 2);
});
