import assert from "node:assert/strict";
import { once } from "node:events";
import { type AddressInfo, createServer } from "node:net";
import { setImmediate } from "node:timers/promises";
import { Aedes } from "aedes";
import { connectAsync } from "mqtt";
import { personDayBounds } from "../src/calendar/time.ts";
import { loadConfig } from "../src/config.ts";
import { writeTransaction } from "../src/db.ts";
import { createMealButtons } from "../src/home-assistant/meal-buttons.ts";
import { createHomeAssistantPublisher } from "../src/home-assistant/publisher.ts";
import { mealNutritionKinds } from "../src/meal-nutrition/index.ts";
import { createOrder } from "../src/orders/index.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

type Packet = { topic: string; payload: Buffer };
type Broker = Aedes & {
  persistence: { createRetainedStream(topic: string): AsyncIterable<Packet> };
};

test("meal buttons follow due dates and presses, rejecting stale and foreign presses", async (context) => {
  let now = new Date("2026-01-01T12:00:00.000Z");
  const timers = new Set<{ at: number; callback(): void }>();
  const clock = {
    now: () => now,
    schedule(callback: () => void, delayMs: number) {
      const timer = { at: now.getTime() + delayMs, callback };
      timers.add(timer);
      return { cancel: () => timers.delete(timer) };
    },
  };
  const hook = { refreshAll() {} };
  const { database, admin, member } = await twoUsers(context, "fallback", {
    clock,
    homeAssistant: hook,
  });
  const order = async (
    person: typeof admin,
    delivery_date: string,
    quantity: number,
  ) => {
    const created = writeTransaction(database, (scope) =>
      createOrder(
        scope,
        person.user,
        {
          service: `Example service ${delivery_date}`,
          delivery_date,
          status: "scheduled",
          meals: [
            { name: `Example bowl ${delivery_date}`, chef: null, quantity },
          ],
        },
        mealNutritionKinds,
        now.toISOString(),
      ),
    );
    const { questions } = await (await person.request("/api/questions")).json();
    const answer = { kcal: 600, protein_g: 35, carbs_g: 60, fat_g: 20 };
    await person.request("/api/questions/answer", {
      method: "POST",
      body: JSON.stringify({
        id: questions.at(-1).id,
        answer: { ...answer, source: "Example label" },
      }),
    });
    const meal = database
      .prepare("SELECT id FROM order_meals WHERE order_id = ?")
      .get(created.id) as { id: number };
    return { order: created.id, meal: meal.id };
  };
  const due = await order(admin, "2026-01-01", 2);
  const later = await order(admin, "2026-01-03", 1);
  const marked = await order(admin, "2026-01-05", 1);
  const foreign = await order(member, "2026-01-01", 1);

  const broker = (await Aedes.createBroker()) as Broker;
  const server = createServer(broker.handle).listen(0);
  await once(server, "listening");
  const url = `mqtt://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const mqtt = loadConfig({ DATABASE_URL: ":memory:", TARE_MQTT_URL: url });
  assert.ok(mqtt.mqtt);
  const publisher = createHomeAssistantPublisher({
    database,
    config: mqtt.mqtt,
    clock,
    clientOptions: { reconnectPeriod: 10 },
  });
  const buttons = createMealButtons({ database, publisher, clock });
  hook.refreshAll = () => publisher.refreshAll();
  publisher.addProvider(buttons.provider);
  const watcher = await connectAsync(url);
  context.after(async () => {
    buttons.stop();
    await watcher.endAsync();
    await publisher.stop();
    await new Promise((done) => broker.close(() => server.close(done)));
  });

  const install = String(
    database.prepare("SELECT id FROM install").pluck().get(),
  );
  const retained = async () => {
    const result = new Map<string, string>();
    for await (const packet of broker.persistence.createRetainedStream("#"))
      result.set(packet.topic, packet.payload.toString());
    return result;
  };
  const button = (userId: number, mealId: number, action: string) =>
    `homeassistant/button/tare_${install}_${userId}/meal_${mealId}_${action}/config`;
  const pressPayload = async (mealId: number, action = "ate") =>
    JSON.parse(
      (await retained()).get(button(admin.user.id, mealId, action)) ?? "{}",
    ).payload_press;
  const settle = async (check: (now: Map<string, string>) => boolean) => {
    while (!check(await retained())) await setImmediate();
  };
  const press = async (payload: string, userId = admin.user.id) => {
    now = new Date(now.getTime() + 1000);
    const at = now.toISOString();
    const topic = `tare/${install}/${userId}/meal_press_result`;
    await watcher.publishAsync(`tare/${install}/${userId}/meal_press`, payload);
    let result: { result?: string; at?: string } = {};
    while (result.at !== at) {
      result = JSON.parse((await retained()).get(topic) ?? "{}");
      await setImmediate();
    }
    return result.result;
  };
  const counts = () =>
    database
      .prepare(
        "SELECT (SELECT count(*) FROM intake_entries) || ':' || group_concat(quantity) FROM order_meals",
      )
      .pluck()
      .get();

  await settle(
    (now) =>
      now.has(button(admin.user.id, due.meal, "ate_three_quarters")) &&
      now.has(button(member.user.id, foreign.meal, "ate")),
  );
  const before = await retained();
  assert.ok(!before.has(button(admin.user.id, later.meal, "ate")));
  assert.deepEqual(JSON.parse(await pressPayload(due.meal)), {
    meal_id: due.meal,
    revision: 1,
    action: "ate",
  });
  const deliveryStart = personDayBounds(
    "2026-01-03",
    admin.user.timezone,
    admin.user.day_start_hour,
  ).start;
  assert.ok([...timers].some((timer) => timer.at === deliveryStart.getTime()));

  await admin.request("/api/orders/mark-delivery", {
    method: "POST",
    body: JSON.stringify({ order_id: marked.order }),
  });
  await settle((now) => now.has(button(admin.user.id, marked.meal, "ate")));
  now = deliveryStart;
  for (const timer of [...timers])
    if (timer.at <= now.getTime()) {
      timers.delete(timer);
      timer.callback();
    }
  await settle((now) => now.has(button(admin.user.id, later.meal, "ate")));

  const first = await pressPayload(due.meal);
  const firstThreeQuarters = await pressPayload(due.meal, "ate_three_quarters");
  assert.equal(await press(first), "logged");
  assert.equal(await press(first), "logged");
  assert.equal(await press(firstThreeQuarters), "stale_revision");
  assert.equal(counts(), "1:1,1,1,1");
  await settle((now) =>
    `${now.get(button(admin.user.id, due.meal, "ate"))}`.includes(
      '\\"revision\\":2',
    ),
  );

  const foreignPress = JSON.stringify({
    meal_id: foreign.meal,
    revision: 1,
    action: "ate",
  });
  assert.equal(await press(foreignPress), "meal_not_found");
  assert.equal(await press("not json"), "invalid_press");
  assert.equal(counts(), "1:1,1,1,1");

  assert.equal(await press(await pressPayload(due.meal)), "logged");
  await settle(
    (now) =>
      !now.has(button(admin.user.id, due.meal, "ate")) &&
      !now.has(button(admin.user.id, due.meal, "ate_three_quarters")),
  );
  assert.equal(counts(), "2:0,1,1,1");
});
