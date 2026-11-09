import assert from "node:assert/strict";
import { once } from "node:events";
import { type AddressInfo, createServer } from "node:net";
import { setImmediate } from "node:timers/promises";
import { Aedes } from "aedes";
import { connectAsync } from "mqtt";
import { loadConfig, type MqttConfig } from "../src/config.ts";
import { openDatabase, writeTransaction } from "../src/db.ts";
import { createHomeAssistantPublisher } from "../src/home-assistant/publisher.ts";
import { createOrderQuestionKinds } from "../src/inbound/questions.ts";
import { deleteWeight } from "../src/queries/delete-weight.ts";
import type { SelectQuestionResult } from "../src/queries/select-question.ts";
import {
  createScaleSubscriber,
  resolveScaleUsers,
} from "../src/scale/ingest.ts";
import { test } from "./support/hang-ceiling.ts";

const BASE = "scale/body-composition";
const clock = { now: () => new Date("2026-03-10T12:00:00.000Z") };
const fixture = (timestamp: string, weight: number, extra = {}) => ({
  ...{ timestamp, weight, impedance: 512, bmi: 23.1, bodyFatPercent: null },
  ...{ muscleMass: 58.4, bmr: 1700, metabolicAge: 34, ...extra },
});

function setup(slugs: Record<string, number> = { alex: 1 }) {
  const { database } = openDatabase(":memory:");
  database.exec(`INSERT INTO users (id, username, timezone, created_at) VALUES
    (1, 'example-alex', 'UTC', '2026-01-01T00:00:00.000Z'),
    (2, 'example-sam', 'UTC', '2026-01-01T00:00:00.000Z')`);
  const kinds = createOrderQuestionKinds({ clock });
  const logs: string[] = [];
  let refreshes = 0;
  const subscriber = (users: Record<string, number>) =>
    createScaleSubscriber({
      ...{ database, topic: BASE, questionKinds: kinds, clock },
      users: new Map(Object.entries(users)),
      log: (code, detail) => logs.push(`${code} ${detail}`),
      onLogged: () => refreshes++,
    });
  let handle = subscriber(slugs);
  return {
    database,
    logs,
    refreshes: () => refreshes,
    remap(users: Record<string, number>) {
      handle = subscriber(users);
    },
    send: (body: unknown, topic = `${BASE}/alex`) =>
      handle(
        Buffer.from(typeof body === "string" ? body : JSON.stringify(body)),
        topic,
      ).status,
    weights: () =>
      database
        .prepare(
          "SELECT user_id, weight_kg, body_fat_pct, source FROM weights ORDER BY id",
        )
        .raw()
        .all() as unknown[][],
    questions: () =>
      database
        .prepare("SELECT * FROM questions ORDER BY id")
        .all() as SelectQuestionResult[],
    answer: (question: SelectQuestionResult | undefined, keep: boolean) =>
      writeTransaction(database, (scope) =>
        question
          ? kinds.get(question.kind)?.apply(scope, question, { keep }, kinds)
          : assert.fail("no question"),
      ),
    seed: (at: string, weight: number) =>
      database
        .prepare(
          "INSERT INTO weights (user_id, client_id, measured_at, day, weight_kg, created_at) VALUES (1, @at, @at, substr(@at, 1, 10), @weight, @at)",
        )
        .run({ at, weight }),
  };
}

test("accepted readings log once with body fat, and count once within 10 minutes across midnight", () => {
  const scale = setup();
  const first = fixture("2026-03-01T23:58:00.000Z", 72.4, {
    ...{ bodyFatPercent: 18.5, skeletalMusclePercent: 41 },
  });
  const repeat = fixture("2026-03-02T00:03:00Z", 72.1);
  const sends = [
    first,
    first,
    repeat,
    fixture("2026-03-02T00:09:00Z", 72.2),
  ].map((reading) => scale.send(reading));
  assert.deepEqual(sends, ["logged", "duplicate", "repeat", "logged"]);
  assert.deepEqual(scale.weights(), [
    [1, 72.4, 18.5, "scale"],
    [1, 72.2, null, "scale"],
  ]);
  assert.equal(scale.refreshes(), 2);
  for (const id of [1, 2]) deleteWeight(scale.database, { user_id: 1, id });
  const replays = [first, repeat].map((reading) => scale.send(reading));
  assert.deepEqual(replays, ["duplicate", "duplicate"]);
  assert.equal(scale.weights().length, 0);
});

test("an implausible reading is a question that never starts the window; keeping it logs once", () => {
  const scale = setup();
  scale.seed("2026-02-28T07:00:00.000Z", 80);
  const far = fixture("2026-03-01T07:00:00Z", 86);
  const later = fixture("2026-03-03T07:00:00Z", 86.5);
  assert.equal(scale.send(far), "question_implausible");
  assert.equal(scale.send(fixture("2026-03-01T07:05:00Z", 80.5)), "logged");
  assert.equal(scale.send(later), "question_implausible");
  const [first, second] = scale.questions();
  assert.match(String(first?.prompt), /86 kg at 2026-03-01 07:00 .* of 80 kg/);
  scale.answer(first, true);
  scale.answer(second, true);
  for (const replay of [far, later])
    assert.equal(scale.send(replay), "duplicate");
  assert.deepEqual(
    scale.weights().map((row) => row[1]),
    [80, 80.5, 86.5],
  );
  assert.equal(scale.questions().length, 2);
});

test("the trend check needs a trend from the last 30 days, built only from earlier readings", () => {
  const scale = setup();
  assert.equal(scale.send(fixture("2026-01-01T07:00:00Z", 72)), "logged");
  assert.equal(scale.send(fixture("2026-02-01T07:00:00Z", 76)), "logged");
  scale.seed("2026-02-03T09:00:00.000Z", 120);
  assert.equal(scale.send(fixture("2026-02-03T06:00:00Z", 74)), "logged");
});

test("unmapped and out-of-range readings become questions and stay judged", () => {
  const scale = setup();
  const stray = fixture("2026-03-01T07:00:00Z", 70);
  assert.equal(scale.send(stray, `${BASE}/guest`), "question_unmapped");
  assert.equal(scale.send(stray, `${BASE}/guest`), "duplicate");
  scale.remap({ alex: 1, guest: 2 });
  assert.equal(scale.send(stray, `${BASE}/guest`), "duplicate");
  for (const [index, weight] of [19.9, 350.5].entries())
    assert.equal(
      scale.send(fixture(`2026-03-0${index + 2}T07:00:00Z`, weight)),
      "question_implausible",
    );
  assert.deepEqual(
    scale.questions().map((question) => `${question.kind} ${question.user_id}`),
    ["scale_unmapped null", "scale_implausible 1", "scale_implausible 1"],
  );
  assert.equal(scale.weights().length, 0);
});

test("shape mismatches are counted and write nothing; the status topic is ignored", () => {
  const scale = setup();
  const good = fixture("2026-03-01T07:00:00Z", 72);
  const cases: [unknown, string?][] = [
    ["not json"],
    ["[1]"],
    [{ ...good, weight: "72" }],
    ['{"timestamp":"2026-03-01T07:00:00Z","weight":1e999}'],
    [{ ...good, timestamp: "2026-02-30T07:00:00Z" }],
    [{ ...good, bodyFatPercent: 140 }],
    [good, BASE],
    ["still not json"],
  ];
  for (const [body, topic] of cases)
    assert.equal(scale.send(body, topic), "invalid_input");
  assert.equal(scale.send("offline", `${BASE}/status`), "ignored");
  assert.deepEqual(
    scale.logs.map((line) => line.replace("scale_reading_invalid ", "")),
    [
      ...["not_json 1", "not_object 1", "bad_weight 1", "bad_weight 2"],
      ...["bad_timestamp 1", "bad_body_fat 1", "missing_slug 1", "not_json 2"],
    ],
  );
  assert.equal(scale.questions().length + scale.weights().length, 0);
  assert.equal(scale.send(good), "logged");
});

test("scale settings fail startup when invalid and need a mapping to enable", () => {
  const env = { DATABASE_URL: ":memory:", TARE_MQTT_URL: "mqtt://127.0.0.1" };
  for (const [users, url = env.TARE_MQTT_URL, error = /distinct/] of [
    ['{"alex":"example-alex","sam":"example-alex"}'],
    ['{"status":"example-alex"}'],
    ['{"alex/two":"example-alex"}'],
    ['{"alex":"example-alex"}', "", /requires TARE_MQTT_URL/],
  ] as const)
    assert.throws(
      () => loadConfig({ ...env, TARE_SCALE_USERS: users, TARE_MQTT_URL: url }),
      error,
    );
  assert.equal(loadConfig({ ...env, TARE_SCALE_TOPIC: "scales" }).scale, null);
  const scale = { topic: BASE, users: { alex: "nobody" } };
  assert.deepEqual(
    loadConfig({ ...env, TARE_SCALE_USERS: '{"alex":"nobody"}' }).scale,
    scale,
  );
  assert.throws(() => resolveScaleUsers(setup().database, scale), /unknown/);
});

test("two scale users land in their own weights over MQTT and survive a reconnect", async (context) => {
  const broker = (await Aedes.createBroker()) as Aedes & {
    clients: Record<string, { id: string; conn: { destroy(): void } }>;
  };
  const server = createServer(broker.handle).listen(0);
  await once(server, "listening");
  const url = `mqtt://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const scale = setup();
  const users = { alex: "example-alex", sam: "example-sam" };
  const handle = createScaleSubscriber({
    ...{ database: scale.database, topic: BASE, clock },
    users: resolveScaleUsers(scale.database, { topic: BASE, users }),
    questionKinds: createOrderQuestionKinds({ clock }),
  });
  const publisher = createHomeAssistantPublisher({
    database: scale.database,
    config: loadConfig({ DATABASE_URL: ":memory:", TARE_MQTT_URL: url })
      .mqtt as MqttConfig,
    clientOptions: { reconnectPeriod: 10 },
  });
  const producer = await connectAsync(url);
  context.after(async () => {
    await producer.endAsync();
    await publisher.stop();
    await new Promise((done) => broker.close(() => server.close(done)));
  });
  const results: string[] = [];
  publisher.subscribe(`${BASE}/+`, (payload, topic) =>
    results.push(handle(payload, topic).status),
  );
  for (const [slug, weight] of Object.entries({ alex: 72, sam: 64 }))
    await producer.publishAsync(
      `${BASE}/${slug}`,
      JSON.stringify(fixture("2026-03-01T07:00:00Z", weight)),
      { retain: true, qos: 1 },
    );
  while (results.length < 2) await setImmediate();
  for (const client of Object.values(broker.clients))
    if (client.id.startsWith("tare-")) client.conn.destroy();
  while (results.length < 4) await setImmediate();
  assert.deepEqual(results, ["logged", "logged", "duplicate", "duplicate"]);
  assert.deepEqual(
    scale.weights().map((row) => row.slice(0, 2).join()),
    ["1,72", "2,64"],
  );
});
