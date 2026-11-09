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
  pressResultTopic,
  pressTopic,
} from "../src/home-assistant/meal-buttons.ts";
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
