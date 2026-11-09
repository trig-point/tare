import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { type AddressInfo, createServer } from "node:net";
import type { TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { promisify } from "node:util";
import { Aedes } from "aedes";
import { connectAsync } from "mqtt";
import { personDayBounds } from "../src/calendar/time.ts";
import { loadConfig } from "../src/config.ts";
import {
  createMealButtons,
  planPressTopic,
  pressResultTopic,
  pressTopic,
} from "../src/home-assistant/meal-buttons.ts";
import {
  nextSlotProvider,
  nextSlotTopic,
} from "../src/home-assistant/next-slot.ts";
import { createHomeAssistantPublisher } from "../src/home-assistant/publisher.ts";
import { sensorProvider } from "../src/home-assistant/snapshot.ts";
import { targetEventProvider } from "../src/home-assistant/target-event.ts";
import { listPeople } from "../src/queries/home-assistant/list-people.ts";
import { createTargetRecomputeJob } from "../src/target/job.ts";
import { profile, seed } from "./support/adaptive-seed.ts";
import { test } from "./support/hang-ceiling.ts";
import { orderMeal } from "./support/order-meals.ts";
import { twoUsers } from "./support/two-users.ts";

type Retained = Map<string, string>;
type SensorConfig = Record<string, string> & {
  device: { identifiers: string[] };
};
type Packet = { topic: string; payload: Buffer };
type Broker = Aedes & {
  persistence: { createRetainedStream(topic: string): AsyncIterable<Packet> };
  clients: Record<string, { id: string; conn: { destroy(): void } }>;
};

function manualClock() {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const timers = new Set<{ at: number; callback(): void }>();
  return {
    timers,
    now: () => now,
    schedule(callback: () => void, delayMs: number) {
      const timer = { at: now.getTime() + delayMs, callback };
      timers.add(timer);
      return { cancel: () => timers.delete(timer) };
    },
  };
}

type Request = Awaited<ReturnType<typeof twoUsers>>["admin"]["request"];
type SlotInput = {
  name: string;
  start_minute: number;
  end_minute: number;
  share: number;
};
const slots = [
  { name: "Breakfast", start_minute: 0, end_minute: 600, share: 72 },
  { name: "Dinner", start_minute: 600, end_minute: 1440, share: 28 },
];

async function planDay(request: Request, slots: SlotInput[]) {
  const post = async (path: string, body: unknown) =>
    (
      await request(path, { method: "POST", body: JSON.stringify(body) })
    ).json();
  const body = { action: "create", name: "Example day", slots };
  const { template } = await post("/api/plan/templates", body);
  const { day_type } = await post("/api/plan/day-types", {
    action: "create",
    name: "Example type",
    template_id: template.id,
  });
  await post("/api/plan/default-day-type", { day_type_id: day_type.id });
  return template.id as number;
}

async function setup(context: TestContext, env: Record<string, string> = {}) {
  const broker = (await Aedes.createBroker()) as Broker;
  const server = createServer(broker.handle).listen(0);
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const rules: { hold?: (topic: string, payload: string) => boolean } = {};
  const held: (() => void)[] = [];
  const published: string[] = [];
  broker.authorizePublish = (client, packet, callback) => {
    published.push(`${packet.topic} ${packet.payload}`);
    if (client && rules.hold?.(packet.topic, packet.payload.toString()))
      held.push(() => callback(null));
    else callback(null);
  };
  const retained = async () => {
    const result: Retained = new Map();
    for await (const packet of broker.persistence.createRetainedStream("#"))
      result.set(packet.topic, packet.payload.toString());
    return result;
  };
  const clock = manualClock();
  const hook = { refreshAll() {} };
  const users = await twoUsers(context, "fallback", {
    clock,
    homeAssistant: hook,
  });
  const settings = loadConfig({
    DATABASE_URL: ":memory:",
    TARE_MQTT_URL: `mqtt://127.0.0.1:${port}`,
    ...env,
  });
  const mqtt = settings.mqtt;
  assert.ok(mqtt);
  const logs: string[] = [];
  const publisher = createHomeAssistantPublisher({
    database: users.database,
    config: mqtt,
    clock,
    clientOptions: { reconnectPeriod: 10 },
    log: (code) => logs.push(code),
  });
  hook.refreshAll = () => publisher.refreshAll();
  context.after(async () => {
    await publisher.stop();
    await new Promise((done) => broker.close(() => server.close(done)));
  });
  publisher.addProvider(sensorProvider(users.database, clock, settings));
  const install = String(
    users.database.prepare("SELECT id FROM install").pluck().get(),
  );
  const state = (retained: Retained, userId: number) =>
    JSON.parse(retained.get(`tare/${install}/${userId}/state`) ?? "{}");
  return {
    ...users,
    settings,
    broker,
    port,
    clock,
    publisher,
    install,
    logs,
    published,
    held,
    retained,
    state,
    status: `tare/${install}/status`,
    statusTopic: mqtt.statusTopic,
    rules,
    settle: async (check: (retained: Retained) => boolean) => {
      while (!check(await retained())) await setImmediate();
    },
    send: async (
      request: typeof users.admin.request,
      path: string,
      body?: unknown,
      method = "POST",
    ) => (await request(path, { method, body: JSON.stringify(body) })).json(),
  };
}

test("devices carry their person's sensors through edits, day changes, births and removals", async (context) => {
  const harness = await setup(context, {
    TARE_HA_DISCOVERY_PREFIX: "custom-ha",
  });
  const { admin, member, install, send, settle, state } = harness;
  const device = (id: number) => `custom-ha/sensor/tare_${install}_${id}/`;
  const configCount = (retained: Retained) =>
    [...retained.keys()].filter((topic) => topic.endsWith("/config")).length;
  await settle((retained) => configCount(retained) === 16);
  const retained = await harness.retained();
  for (const user of [admin.user, member.user]) {
    const configs: Record<string, SensorConfig> = Object.fromEntries(
      [...retained]
        .filter(([topic]) => topic.startsWith(device(user.id)))
        .map(([topic, payload]) => [topic.split("/")[3], JSON.parse(payload)]),
    );
    assert.equal(
      Object.keys(configs).sort().join(),
      "calorie_target,calories_eaten,calories_remaining,protein_eaten,protein_remaining,protein_target,tdee_estimate,weight_trend",
    );
    const slug = user.username.replace("-", "_");
    for (const [key, config] of Object.entries(configs)) {
      assert.equal(config.unique_id, `tare_${install}_${user.id}_${key}`);
      assert.equal(
        `${config.device.identifiers}`,
        `tare_${install}_${user.id}`,
      );
      assert.equal(config.default_entity_id, `sensor.tare_${slug}_${key}`);
      assert.equal(config.state_class, "measurement");
      assert.equal(
        config.suggested_display_precision,
        key === "weight_trend" ? 1 : 0,
      );
    }
    assert.match(
      `${configs.calories_eaten?.json_attributes_template}`,
      /kcal_/,
    );
    assert.match(`${configs.protein_eaten?.json_attributes_template}`, /prot/);
  }

  const soup = { client_id: "a", name: "Example soup", kcal: 500 };
  const logged = await send(admin.request, "/api/intake", soup);
  await send(member.request, "/api/weights", { client_id: "w", weight_kg: 70 });
  await send(member.request, "/api/intake", { ...soup, kcal: 300 });
  await settle((now) => state(now, member.user.id).calories_eaten === 300);
  const now = await harness.retained();
  assert.equal(state(now, member.user.id).protein_complete, false);
  assert.equal(state(now, member.user.id).weight_trend, 70);
  await send(admin.request, `/api/intake/${logged.entry.id}`, null, "DELETE");
  await settle(
    (now) =>
      state(now, admin.user.id).calories_eaten === 0 &&
      state(now, member.user.id).calories_eaten === 300,
  );

  const before = [...harness.clock.timers];
  const settings = { timezone: "Pacific/Honolulu", day_start_hour: 4 };
  await send(member.request, "/api/me", settings, "PATCH");
  await settle((now) => state(now, member.user.id).calories_eaten === 0);
  const after = [...harness.clock.timers];
  const end = (day: string, zone: string) =>
    personDayBounds(day, zone, 4).end.getTime();
  assert.deepEqual(
    before.filter((timer) => after.includes(timer)).map((timer) => timer.at),
    [end("2026-01-01", admin.user.timezone)],
  );
  assert.deepEqual(
    after.filter((timer) => !before.includes(timer)).map((timer) => timer.at),
    [end("2025-12-31", settings.timezone)],
  );

  const watcher = await connectAsync(`mqtt://127.0.0.1:${harness.port}`);
  context.after(() => watcher.endAsync());
  const cleared = `${device(member.user.id)}weight_trend/config`;
  await watcher.publishAsync(cleared, "", { retain: true, qos: 1 });
  await watcher.publishAsync("homeassistant/status", "online", { qos: 1 });
  await settle((now) => now.has(cleared));

  const guest = await send(admin.request, "/api/users", {
    username: "example-guest",
    password: "invented-guest-password",
  });
  const extra = `${device(guest.user.id)}extra/config`;
  let extraEnabled = true;
  harness.publisher.addProvider((person) => ({
    entities:
      extraEnabled && person.id === guest.user.id
        ? [{ component: "sensor", key: "extra", config: { name: "Extra" } }]
        : [],
    state: {},
  }));
  await settle((now) => now.has(extra));
  const rows = harness.database
    .prepare("SELECT count(*) FROM ha_entities WHERE topic = ?")
    .pluck();
  harness.rules.hold = (topic) => topic === extra;
  extraEnabled = false;
  harness.publisher.refreshAll();
  while (!harness.held.length) await setImmediate();
  assert.equal(rows.get(extra), 1);
  harness.held.splice(0)[0]?.();
  await settle((now) => !now.has(extra) && configCount(now) === 24);
  while (rows.get(extra) !== 0) await setImmediate();
});

test("the latest value wins over held acks and outages, and stop marks offline", async (context) => {
  const harness = await setup(context);
  const { admin, send, settle, state, status } = harness;
  const eaten = (now: Retained) => state(now, admin.user.id).calories_eaten;
  await settle((now) => now.get(status) === "online" && eaten(now) === 0);
  harness.rules.hold = (topic) => topic.endsWith(`/${admin.user.id}/state`);
  const soup = { client_id: "a", name: "Example soup", kcal: 500 };
  const logged = await send(admin.request, "/api/intake", soup);
  while (!harness.held.length) await setImmediate();
  await send(admin.request, `/api/intake/${logged.entry.id}`, null, "DELETE");
  harness.rules.hold = undefined;
  const stale = harness.published.length;
  harness.held.splice(0)[0]?.();
  const later = () => harness.published.slice(stale).join("\n");
  while (!later().includes("/state")) await setImmediate();
  await settle((now) => eaten(now) === 0);

  for (const client of Object.values(harness.broker.clients))
    if (client.id === `tare-${harness.install}`) client.conn.destroy();
  await settle((now) => now.get(status) === "offline");
  await send(admin.request, "/api/intake", { ...soup, client_id: "b" });
  await send(admin.request, "/api/intake", { ...soup, client_id: "c" });
  await settle((now) => now.get(status) === "online" && eaten(now) === 1000);
  await harness.publisher.stop();
  assert.equal((await harness.retained()).get(status), "offline");

  const lost = await setup(context);
  await lost.settle((now) => now.get(lost.status) === "online");
  lost.rules.hold = (_topic, payload) => payload === "offline";
  const stopping = lost.publisher.stop();
  while (!lost.held.length) await setImmediate();
  lost.rules.hold = undefined;
  const before = lost.published.length;
  for (const timer of [...lost.clock.timers]) timer.callback();
  await stopping;
  assert.deepEqual(lost.logs, ["mqtt_offline_unconfirmed"]);
  assert.ok(
    !lost.published.slice(before).some((line) => line.endsWith(" online")),
  );
});

test("meal button presses arrive through the broker, after a reconnect and a new day", async (context) => {
  const harness = await setup(context);
  const { admin, member, database, install, clock, publisher, settle } =
    harness;
  const now = clock.now().toISOString();
  const due = await orderMeal(database, admin, "2026-01-01", 3, now);
  const later = await orderMeal(database, admin, "2026-01-02", 1, now);
  const foreign = await orderMeal(database, member, "2026-01-01", 1, now);
  publisher.addProvider(
    createMealButtons({ database, clock, publisher }).provider,
  );
  const button = `homeassistant/button/tare_${install}_${admin.user.id}`;
  const config = (now: Retained, meal: number, action = "ate") =>
    now.get(`${button}/meal_${meal}_${action}/config`);
  const payload = (now: Retained, meal: number, action = "ate") =>
    JSON.parse(config(now, meal, action) ?? "{}").payload_press;
  const revision = (now: Retained, meal: number, action = "ate") =>
    JSON.parse(payload(now, meal, action) ?? "{}").revision;
  const resultTopic = pressResultTopic(install, admin.user.id);
  const result = (now: Retained) =>
    JSON.parse(now.get(resultTopic) ?? "{}").result;
  await settle(
    (now) =>
      revision(now, due) === 1 &&
      revision(now, due, "ate_three_quarters") === 1 &&
      result(now) === "none",
  );
  const first = await harness.retained();
  assert.equal(config(first, later), undefined);

  const client = await connectAsync(`mqtt://127.0.0.1:${harness.port}`);
  context.after(() => client.endAsync());
  const topic = pressTopic(install, admin.user.id);
  const press = async (sent: string, expected: string) => {
    const before = (await harness.retained()).get(resultTopic);
    await client.publishAsync(topic, sent, { qos: 1 });
    await settle((now) => now.get(resultTopic) !== before);
    assert.equal(result(await harness.retained()), expected);
  };
  await press(payload(first, due), "logged");
  await settle((now) => revision(now, due) === 2);
  await press(payload(first, due, "ate_three_quarters"), "stale_revision");
  await press(payload(first, due), "logged");
  const foreignPress = { meal_id: foreign, revision: 1, action: "ate" };
  await press(JSON.stringify(foreignPress), "meal_not_found");
  await press("not json", "invalid_press");
  const count = database.prepare("SELECT count(*) FROM intake_entries");
  assert.equal(count.pluck().get(), 1);

  for (const peer of Object.values(harness.broker.clients))
    if (peer.id === `tare-${install}`) peer.conn.destroy();
  await settle((now) => now.get(harness.status) === "offline");
  await settle((now) => now.get(harness.status) === "online");
  await press(payload(await harness.retained(), due), "logged");
  await settle((now) => revision(now, due) === 3);

  const dayEnd = personDayBounds("2026-01-01", admin.user.timezone, 4).end;
  clock.now().setTime(dayEnd.getTime());
  for (const timer of [...clock.timers])
    if (timer.at <= dayEnd.getTime()) timer.callback();
  await settle((now) => revision(now, later) === 1);
  await press(payload(await harness.retained(), later), "logged");
  await settle((now) => config(now, later) === undefined);
});

test("planned-item buttons and the next-slot sensor follow presses, entries, plan edits and slot ends", async (context) => {
  const harness = await setup(context);
  const { admin, member, database, install, clock, publisher, send, settle } =
    harness;
  database.exec("UPDATE users SET timezone = 'UTC', day_start_hour = 0");
  const food = (userId: number) =>
    Number(
      database
        .prepare(
          "INSERT INTO foods (user_id, name, kcal, provenance) VALUES (?, 'Example soup', 100, 'estimated')",
        )
        .run(userId).lastInsertRowid,
    );
  const soup = food(admin.user.id);
  const template = await planDay(admin.request, slots);
  await planDay(member.request, slots);
  await send(admin.request, "/api/profile", profile);
  await send(admin.request, "/api/weights", { client_id: "w", weight_kg: 80 });
  database
    .prepare(
      "INSERT INTO target_results (user_id, computed_at, trigger, kcal, protein_g, basis) VALUES (?, '2026-01-01T00:00:00.000Z', 'weekly', 2000, 120, 'formula')",
    )
    .run(admin.user.id);
  const breakfast = await send(admin.request, "/api/plan/slot", {
    position: 0,
    food_id: soup,
  });
  const dinner = await send(admin.request, "/api/plan/slot", {
    position: 1,
    food_id: soup,
  });
  const foreign = await send(member.request, "/api/plan/slot", {
    position: 1,
    food_id: food(member.user.id),
  });
  publisher.addProvider(
    createMealButtons({ database, clock, publisher }).provider,
  );
  publisher.addProvider(nextSlotProvider(database, clock, harness.settings));
  let failing = false;
  publisher.addProvider(() => {
    if (failing) throw new Error("provider_failed");
    return { entities: [], state: {} };
  });

  const button = (now: Retained, item: number, action = "ate") =>
    JSON.parse(
      now.get(
        `homeassistant/button/tare_${install}_${admin.user.id}/plan_${item}_${action}/config`,
      ) ?? "null",
    );
  const revision = (now: Retained, item: number) =>
    JSON.parse(button(now, item)?.payload_press ?? "null")?.revision;
  const next = async () =>
    JSON.parse(
      (await harness.retained()).get(nextSlotTopic(install, admin.user.id)) ??
        "null",
    );
  const client = await connectAsync(`mqtt://127.0.0.1:${harness.port}`);
  context.after(() => client.endAsync());
  // A status "online" starts a replay, which opens with the availability topic once the running
  // reconcile is done. The first replay picks up the action; the second starts only after it finishes.
  const replayed = async () => {
    const mark = harness.published.length;
    await client.publishAsync(harness.statusTopic, "online", { qos: 1 });
    while (!harness.published.slice(mark).includes(`${harness.status} online`))
      await setImmediate();
  };
  const flushed = async () => {
    await replayed();
    await replayed();
  };
  await settle((now) => now.get(harness.status) === "online");
  await flushed();
  const first = await harness.retained();
  assert.deepEqual(await next(), {
    remaining: 1440,
    slot: "Breakfast",
    budget: 1440,
  });
  for (const action of ["ate", "ate_three_quarters", "skip"])
    assert.equal(
      button(first, dinner.item.id, action).name,
      `Dinner: Example soup ${action === "ate" ? "ate it" : action === "skip" ? "skip" : "ate 3/4"}`,
    );
  assert.equal(button(first, foreign.item.id), null);

  const resultTopic = pressResultTopic(install, admin.user.id);
  const pressed = async (payload: string, expected: string) => {
    const before = (await harness.retained()).get(resultTopic);
    // A new press time makes every result payload differ, so a wrong result is asserted, not waited on.
    clock.now().setTime(clock.now().getTime() + 1000);
    await client.publishAsync(planPressTopic(install, admin.user.id), payload, {
      qos: 1,
    });
    await settle((now) => now.get(resultTopic) !== before);
    const after = (await harness.retained()).get(resultTopic) ?? "{}";
    assert.equal(JSON.parse(after).result, expected);
    await flushed();
  };
  const stale = button(first, dinner.item.id).payload_press;
  await send(admin.request, "/api/plan/slot", {
    position: 1,
    food_id: soup,
    servings: 2,
    item_id: dinner.item.id,
    revision: dinner.item.revision,
  });
  await flushed();
  assert.equal(revision(await harness.retained(), dinner.item.id), 2);

  await pressed(
    button(first, breakfast.item.id, "skip").payload_press,
    "logged",
  );
  assert.equal(
    button(await harness.retained(), breakfast.item.id, "skip"),
    null,
  );
  await send(admin.request, "/api/plan/shares", {
    template_id: template,
    shares: [
      { position: 0, share: 50 },
      { position: 1, share: 50 },
    ],
  });
  await send(admin.request, "/api/intake", {
    client_id: "a",
    name: "Example oats",
    kcal: 1440,
  });
  await flushed();
  assert.deepEqual(await next(), {
    remaining: -440,
    slot: "Breakfast",
    budget: 1000,
  });
  const slotEnd = new Date("2026-01-01T10:00:00.000Z").getTime();
  assert.ok([...clock.timers].some((timer) => timer.at === slotEnd));
  clock.now().setTime(slotEnd);
  failing = true;
  const failures = harness.logs.length;
  for (const timer of [...clock.timers])
    if (timer.at <= slotEnd) {
      clock.timers.delete(timer);
      timer.callback();
    }
  while (
    !harness.logs.slice(failures).includes("home_assistant_publish_failed")
  )
    await setImmediate();
  const dayEnd = new Date("2026-01-02T00:00:00.000Z").getTime();
  const dayEnds = [...clock.timers].filter((timer) => timer.at === dayEnd);
  assert.equal(dayEnds.length, 2);
  failing = false;
  await flushed();
  assert.deepEqual(await next(), {
    remaining: 560,
    slot: "Dinner",
    budget: 560,
  });
  await send(admin.request, "/api/intake", {
    client_id: "b",
    name: "Example bread",
    kcal: 200,
  });
  await flushed();
  assert.deepEqual(await next(), {
    remaining: 360,
    slot: "Dinner",
    budget: 560,
  });

  const current = button(await harness.retained(), dinner.item.id);
  await pressed(current.payload_press, "logged");
  assert.equal(button(await harness.retained(), dinner.item.id), null);
  assert.deepEqual(await next(), {
    remaining: 160,
    slot: "Dinner",
    budget: 560,
  });
  await pressed(stale, "stale_revision");
  const foreignPress = { item_id: foreign.item.id, revision: 1, action: "ate" };
  await pressed(JSON.stringify(foreignPress), "planned_item_not_found");
  const count = "SELECT count(*) FROM intake_entries WHERE user_id = ?";
  assert.equal(database.prepare(count).pluck().get(admin.user.id), 3);
  assert.equal(database.prepare(count).pluck().get(member.user.id), 0);
});

test("the next-slot refresh lands on the true slot end across clock changes", async (context) => {
  const clock = manualClock();
  const { admin, database } = await twoUsers(context, "fallback", { clock });
  database.exec(
    "UPDATE users SET timezone = 'America/New_York', day_start_hour = 0",
  );
  await planDay(admin.request, [
    { name: "Early", start_minute: 0, end_minute: 90, share: 20 },
    { name: "Breakfast", start_minute: 90, end_minute: 210, share: 30 },
    { name: "Dinner", start_minute: 210, end_minute: 1440, share: 50 },
  ]);
  const post = (path: string, body: unknown) =>
    admin.request(path, { method: "POST", body: JSON.stringify(body) });
  await post("/api/profile", profile);
  await post("/api/weights", { client_id: "w", weight_kg: 80 });
  database
    .prepare(
      "INSERT INTO target_results (user_id, computed_at, trigger, kcal, protein_g, basis) VALUES (?, '2026-01-01T00:00:00.000Z', 'weekly', 2000, 120, 'formula')",
    )
    .run(admin.user.id);
  const provider = nextSlotProvider(
    database,
    clock,
    loadConfig({ DATABASE_URL: ":memory:" }),
  );
  const person = listPeople(database).find((row) => row.id === admin.user.id);
  assert.ok(person);
  const refreshAt = (instant: string) => {
    clock.now().setTime(Date.parse(instant));
    return provider(person, { state: "", events: "" }).refreshAt?.toISOString();
  };
  // 1:40 AM EST on the spring-forward day: Breakfast ends at 3:30 AM EDT.
  assert.equal(
    refreshAt("2026-03-08T06:40:00.000Z"),
    "2026-03-08T07:30:00.000Z",
  );
  // 1:10 AM EST, the second pass of the fall-back hour: Early ends at 1:30 AM EST.
  assert.equal(
    refreshAt("2026-11-01T06:10:00.000Z"),
    "2026-11-01T06:30:00.000Z",
  );
});

test("a recompute that changes a target fires one event and sets the TDEE sensor, per person", async (context) => {
  const harness = await setup(context);
  const { admin, member, database, send, settle, state } = harness;
  harness.publisher.addProvider(targetEventProvider(database));
  await send(admin.request, "/api/profile", profile);
  seed(database, admin.user.id);
  await send(member.request, "/api/weights", { client_id: "w", weight_kg: 60 });
  await send(member.request, "/api/profile", profile);
  const job = createTargetRecomputeJob({
    ...{ database, clock: harness.clock, weekday: 1 },
    settings: loadConfig({ DATABASE_URL: ":memory:" }).tdee,
    onFinished: () => harness.publisher.refreshAll(),
  });
  const events = () => harness.published.filter((line) => /events /.test(line));
  const event = (id: number, kcal: number[], protein: number[]) =>
    `tare/${harness.install}/${id}/events {"event_type":"target_changed","old_kcal":${kcal[0]},"old_protein_g":${protein[0]},"new_kcal":${kcal.at(-1)},"new_protein_g":${protein.at(-1)}}`;
  await job.run({ signal: AbortSignal.any([]) });
  await settle(
    (now) =>
      state(now, admin.user.id).tdee_estimate === 2675 && events().length > 0,
  );
  assert.deepEqual(events(), [event(admin.user.id, [2410, 2400], [128])]);
  assert.equal(
    state(await harness.retained(), member.user.id).tdee_estimate,
    null,
  );
  database
    .prepare("UPDATE profiles SET protein_factor = 2 WHERE user_id = ?")
    .run(member.user.id);
  await job.run({ signal: AbortSignal.any([]) });
  while (events().length < 2) await setImmediate();
  assert.deepEqual(events().slice(1), [
    event(member.user.id, [2100], [96, 120]),
  ]);
  const restarted = targetEventProvider(database);
  for (const person of listPeople(database))
    assert.deepEqual(restarted(person, { state: "", events: "" }).events, []);
});

test("MQTT settings parse, and the importer refuses while the engine answers", async (context) => {
  const base = { DATABASE_URL: ":memory:" };
  const url = " mqtt://broker.example:1883 ";
  const { mqtt } = loadConfig({ ...base, TARE_MQTT_URL: url });
  assert.equal(mqtt?.url, url.trim());
  for (const [env, variable] of [
    [{ TARE_MQTT_URL: "http://broker.example" }, "TARE_MQTT_URL"],
    [{ TARE_MQTT_USERNAME: "example" }, "TARE_MQTT_PASSWORD"],
  ] as const)
    assert.throws(() => loadConfig({ ...base, ...env }), {
      message: new RegExp(`^${variable}`),
    });

  const engine = createHttpServer((_request, response) =>
    response.end('{"status":"ok"}'),
  ).listen(0, "127.0.0.1");
  await once(engine, "listening");
  context.after(() => engine.close());
  const script = new URL("../scripts/import.mts", import.meta.url).pathname;
  const port = String((engine.address() as AddressInfo).port);
  const result = await promisify(execFile)(
    process.execPath,
    [script, "--user", "example", "--weight", "missing.json"],
    { env: { ...process.env, DATABASE_URL: ":memory:", PORT: port } },
  ).catch((error: { stderr: string }) => error);
  assert.deepEqual(JSON.parse(result.stderr), { code: "engine_running" });
});
