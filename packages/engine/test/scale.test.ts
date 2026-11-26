import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { Aedes } from "aedes";
import Database from "better-sqlite3";
import { connectAsync } from "mqtt";
import { loadConfig, type MqttConfig } from "../src/config.ts";
import { applyMigrations, openDatabase, writeTransaction } from "../src/db.ts";
import { createHomeAssistantPublisher } from "../src/home-assistant/publisher.ts";
import { createOrderQuestionKinds } from "../src/inbound/questions.ts";
import { deleteWeight } from "../src/queries/delete-weight.ts";
import type { SelectQuestionResult } from "../src/queries/select-question.ts";
import { updateWeight } from "../src/queries/update-weight.ts";
import {
  createScaleSubscriber,
  resolveScaleUsers,
} from "../src/scale/ingest.ts";
import * as auth from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";

const BASE = "scale/body-composition";
const clock = { now: () => new Date("2026-03-10T12:00:00.000Z") };
const ENV = { DATABASE_URL: ":memory:", TARE_MQTT_URL: "mqtt://127.0.0.1" };
const load = (env: Record<string, string>) => loadConfig({ ...ENV, ...env });
const WEIGHTS =
  "SELECT user_id, weight_kg, body_fat_pct, source FROM weights ORDER BY id";
const SEED =
  "INSERT INTO weights (user_id, client_id, measured_at, day, weight_kg, created_at) VALUES (1, @at, @at, substr(@at, 1, 10), @weight, @at)";
const fixture = (timestamp: string, weight: number, extra = {}) => ({
  ...{ timestamp, weight, impedance: 512, bmi: 23.1, bodyFatPercent: null },
  ...{ muscleMass: 58.4, bmr: 1700, metabolicAge: 34, ...extra },
});

function setup(
  database = openDatabase(":memory:").database,
  waitForRetry?: (delayMs: number) => Promise<void>,
) {
  database.exec(`INSERT INTO users (id, username, timezone, created_at) VALUES
    (1, 'example-alex', 'UTC', '2026-01-01T00:00:00.000Z'),
    (2, 'example-sam', 'UTC', '2026-01-01T00:00:00.000Z')`);
  const kinds = createOrderQuestionKinds({ clock });
  const logs: string[] = [];
  let refreshes = 0;
  const subscriber = (users: ReadonlyMap<string, number>) =>
    createScaleSubscriber({
      ...{ database, topic: BASE, questionKinds: kinds, clock, users },
      waitForRetry,
      log: (code, detail) => logs.push(`${code} ${detail}`),
      onLogged: () => refreshes++,
    });
  let handle = subscriber(new Map([["alex", 1]]));
  const send = async (body: unknown, topic = `${BASE}/alex`) => {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return (await handle(Buffer.from(text), topic)).status;
  };
  return {
    database,
    logs,
    send,
    async sends(...bodies: unknown[]) {
      const results = [];
      for (const body of bodies) results.push(await send(body));
      return results;
    },
    refreshes: () => refreshes,
    remap(users: ReadonlyMap<string, number>) {
      handle = subscriber(users);
    },
    weights: () => database.prepare(WEIGHTS).raw().all() as unknown[][],
    questions: () =>
      database
        .prepare("SELECT * FROM questions ORDER BY id")
        .all() as SelectQuestionResult[],
    keep: (question?: SelectQuestionResult) =>
      writeTransaction(database, (scope) => {
        const asked = question ?? assert.fail("no question");
        kinds.get(asked.kind)?.apply(scope, asked, { keep: true }, kinds);
      }),
    seed: (at: string, weight: number) =>
      database.prepare(SEED).run({ at, weight }),
  };
}

function breakfast(database: Database.Database) {
  const at = "2026-03-10T07:00:00.000Z";
  database
    .prepare(`INSERT INTO intake_entries
    (user_id, client_id, name, eaten_at, day, provenance, created_at, updated_at)
    VALUES (1, 'example-breakfast', 'Example breakfast', ?, '2026-03-10', 'label', ?, ?)`)
    .run(at, at, at);
}

function scratch(context: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "tare-scale-"));
  context.after(() => rmSync(dir, { force: true, recursive: true }));
  return dir;
}

test("the first reading logs, the next asks, and exact replays write nothing", async () => {
  const scale = setup();
  const first = fixture("2026-03-01T07:00:00.000Z", 72.4, {
    bodyFatPercent: 18.5,
  });
  const second = fixture("2026-03-01T07:05:00Z", 72.1);
  const nextDay = fixture("2026-03-02T07:00:00Z", 72.2);
  assert.deepEqual(await scale.sends(first, first, second, nextDay), [
    "logged",
    "duplicate",
    "question_review",
    "logged",
  ]);
  assert.deepEqual(scale.weights(), [
    [1, 72.4, 18.5, "scale"],
    [1, 72.2, null, "scale"],
  ]);
  assert.equal(scale.refreshes(), 2);
  const edit = { measured_at: first.timestamp, day: "2026-03-01" };
  const edited = { ...edit, weight_kg: 80, body_fat_pct: null, note: null };
  updateWeight(scale.database, edited, { user_id: 1, id: 1 });
  assert.equal(await scale.send(second), "duplicate");
  assert.equal(scale.questions().length, 1);
  for (const id of [1, 2]) deleteWeight(scale.database, { user_id: 1, id });
  assert.deepEqual(await scale.sends(first, second), [
    "duplicate",
    "duplicate",
  ]);
  assert.equal(scale.weights().length, 0);
  assert.equal(scale.logs.length, 0);
});

test("an implausible first reading still counts as the day's first receipt", async () => {
  const scale = setup();
  scale.seed("2026-02-28T07:00:00.000Z", 80);
  const far = fixture("2026-03-01T07:00:00Z", 86);
  const closer = fixture("2026-03-01T07:05:00Z", 80.5);
  assert.deepEqual(await scale.sends(far, closer), [
    "question_implausible",
    "question_review",
  ]);
  const [first, second] = scale.questions();
  assert.match(String(first?.prompt), /86 kg at 2026-03-01 07:00 .* of 80 kg/);
  for (const question of [first, second]) scale.keep(question);
  assert.deepEqual(await scale.sends(far, closer), ["duplicate", "duplicate"]);
  assert.deepEqual(
    scale.weights().map((row) => row[1]),
    [80, 86, 80.5],
  );
});

test("the trend ignores older history and a later manual weight blocks auto-log", async () => {
  const scale = setup();
  assert.equal(await scale.send(fixture("2026-01-01T07:00:00Z", 72)), "logged");
  assert.equal(await scale.send(fixture("2026-02-01T07:00:00Z", 76)), "logged");
  scale.seed("2026-02-03T09:00:00.000Z", 120);
  assert.equal(
    await scale.send(fixture("2026-02-03T06:00:00Z", 74)),
    "question_review",
  );
});

test("weights older than 30 days do not move the trend the reading is checked against", async () => {
  const scale = setup();
  scale.seed("2025-01-01T07:00:00.000Z", 120);
  scale.seed("2026-02-27T07:00:00.000Z", 80);
  assert.equal(await scale.send(fixture("2026-03-01T07:00:00Z", 81)), "logged");
});

test("a reading after food becomes a question", async () => {
  for (const mutation of [
    "",
    "DELETE FROM intake_entries",
    "UPDATE intake_entries SET day = '2026-03-11', eaten_at = '2026-03-11T07:00:00.000Z'",
  ]) {
    const scale = setup();
    breakfast(scale.database);
    if (mutation) scale.database.exec(mutation);
    assert.equal(
      await scale.send(fixture("2026-03-10T08:00:00Z", 72)),
      "question_review",
    );
    assert.equal(scale.weights().length, 0);
    assert.equal(scale.questions().length, 1);
    if (mutation.startsWith("UPDATE"))
      assert.equal(
        await scale.send(fixture("2026-03-11T08:00:00Z", 72)),
        "question_review",
      );
    scale.database.close();
  }
  const scale = setup();
  breakfast(scale.database);
  assert.equal(await scale.send(fixture("2026-03-10T07:00:00Z", 72)), "logged");
  scale.database.close();
});

test("0056 seeds food history and preserves undated and answered legacy receipts", async (context) => {
  const directory = scratch(context);
  const migrations = new URL("../migrations/", import.meta.url);
  const previous = join(directory, "migrations");
  cpSync(migrations, previous, {
    recursive: true,
    filter: (path) => !path.includes("0056_"),
  });
  const database = new Database(":memory:");
  context.after(() => database.close());
  database.pragma("foreign_keys = ON");
  applyMigrations(database, pathToFileURL(`${previous}/`));
  const scale = setup(database);
  breakfast(database);
  database.exec(`
    INSERT INTO scale_readings VALUES ('scale:alex:2026-03-11T08:00:00.000Z', 1, '2026-03-11T08:00:00.000Z');
    INSERT INTO questions (user_id, kind, subject_ref, prompt, answer_schema, status, answer, created_at, answered_at)
    VALUES (1, 'scale_implausible', 'scale:alex:2026-03-12T08:00:00.000Z', 'Keep it?', '{}', 'answered',
      '{"keep":false}', '2026-03-12T08:00:00.000Z', '2026-03-12T08:01:00.000Z');
  `);
  applyMigrations(database, migrations);
  database.exec("DELETE FROM intake_entries");
  assert.deepEqual(
    await scale.sends(
      fixture("2026-03-10T09:00:00Z", 72),
      fixture("2026-03-11T09:00:00Z", 72),
      fixture("2026-03-12T08:00:00Z", 72),
      fixture("2026-03-12T09:00:00Z", 72),
      fixture("2026-03-13T09:00:00Z", 72),
    ),
    [
      "question_review",
      "question_review",
      "duplicate",
      "question_review",
      "logged",
    ],
  );
});

test("food logged during a rollback uses the same Tare day as the scale", async (context) => {
  const times = {
    food: "2026-10-25T01:15:00.000Z",
    reading: "2026-10-25T01:30:00.000Z",
  };
  for (const [timezone, day] of [
    ["America/New_York", "2026-10-24"],
    ["Antarctica/Troll", "2026-10-25"],
  ]) {
    const { database, app, signIn, admin, setNow } = auth.fixture(context);
    setNow(times.food);
    database
      .prepare("UPDATE users SET timezone = ?, day_start_hour = 2")
      .run(timezone);
    const headers = {
      ...auth.requestedWith,
      Cookie: auth.cookie(await signIn()),
    };
    const response = await app.request("/api/intake", {
      method: "POST",
      headers,
      body: JSON.stringify({
        client_id: "example-food",
        name: "Example oats",
        kcal: 150,
      }),
    });
    assert.equal(response.status, 201);
    const readingClock = { now: () => new Date(times.reading) };
    const ingest = createScaleSubscriber({
      database,
      topic: BASE,
      users: new Map([["alex", admin.id]]),
      clock: readingClock,
      questionKinds: createOrderQuestionKinds({ clock: readingClock }),
    });
    const result = await ingest(
      Buffer.from(JSON.stringify(fixture(times.reading, 72))),
      `${BASE}/alex`,
    );
    assert.equal(result.status, "question_review", timezone);
    const today = await app.request("/api/today", { headers });
    assert.equal(today.status, 200);
    const ledger = await today.json();
    assert.equal(ledger.day, day, timezone);
    assert.equal(ledger.totals.kcal.total, 150, timezone);
  }
});

test("a manual weight during a rollback blocks scale auto-log on the same Tare day", async (context) => {
  const manualAt = "2026-10-25T01:15:00.000Z";
  const scaleAt = "2026-10-25T01:30:00.000Z";
  for (const [timezone, day] of [
    ["America/New_York", "2026-10-24"],
    ["Antarctica/Troll", "2026-10-25"],
  ]) {
    const { database, app, signIn, admin, setNow } = auth.fixture(context);
    setNow(manualAt);
    database
      .prepare("UPDATE users SET timezone = ?, day_start_hour = 2")
      .run(timezone);
    const response = await app.request("/api/weights", {
      method: "POST",
      headers: { ...auth.requestedWith, Cookie: auth.cookie(await signIn()) },
      body: JSON.stringify({ client_id: "example-manual", weight_kg: 72 }),
    });
    assert.equal(response.status, 201);
    const clock = { now: () => new Date(scaleAt) };
    const ingest = createScaleSubscriber({
      database,
      topic: BASE,
      users: new Map([["alex", admin.id]]),
      clock,
      questionKinds: createOrderQuestionKinds({ clock }),
    });
    const result = await ingest(
      Buffer.from(JSON.stringify(fixture(scaleAt, 72))),
      `${BASE}/alex`,
    );
    assert.equal(result.status, "question_review", timezone);
    assert.equal((await response.json()).entry.day, day, timezone);
  }
});

test("scale refresh runs after commit with the original busy timeout", async (context) => {
  const { database, admin } = auth.fixture(context);
  database.pragma("busy_timeout = 4321");
  const refreshes: unknown[] = [];
  const ingest = createScaleSubscriber({
    database,
    topic: BASE,
    users: new Map([["alex", admin.id]]),
    clock,
    questionKinds: createOrderQuestionKinds({ clock }),
    onLogged: () =>
      refreshes.push({
        timeout: database.pragma("busy_timeout", { simple: true }),
        inTransaction: database.inTransaction,
      }),
  });
  const result = await ingest(
    Buffer.from(JSON.stringify(fixture("2026-03-10T12:00:00.000Z", 72))),
    `${BASE}/alex`,
  );
  assert.equal(result.status, "logged");
  assert.deepEqual(refreshes, [{ timeout: 4321, inTransaction: false }]);
});

test("0056 assigns rollback-era food to the Tare day that contained it", async (context) => {
  const migrations = new URL("../migrations/", import.meta.url);
  const previous = join(scratch(context), "migrations");
  cpSync(migrations, previous, {
    recursive: true,
    filter: (path) => !path.includes("0056_"),
  });
  const database = new Database(":memory:");
  context.after(() => database.close());
  applyMigrations(database, pathToFileURL(`${previous}/`));
  const scale = setup(database);
  database.exec(`
    UPDATE users SET timezone = 'Antarctica/Troll', day_start_hour = 2 WHERE id = 1;
    INSERT INTO intake_entries
      (user_id, client_id, name, eaten_at, day, provenance, created_at, updated_at)
    VALUES (1, 'fold-food', 'Example oats', '2026-10-25T01:15:00.000Z', '2026-10-24',
      'estimated', '2026-10-25T01:15:00.000Z', '2026-10-25T01:15:00.000Z');
  `);
  applyMigrations(database, migrations);
  database.exec("DELETE FROM intake_entries");
  assert.equal(
    await scale.send(fixture("2026-10-25T01:30:00.000Z", 72)),
    "question_review",
  );
});

test("Keep records on the frozen day and Discard reports no weight", async (context) => {
  const questionKinds = createOrderQuestionKinds({ clock });
  const { database, app, admin, signIn } = auth.fixture(context, {
    questionKinds,
  });
  database.exec("UPDATE users SET day_start_hour = 0");
  const headers = {
    ...auth.requestedWith,
    Cookie: auth.cookie(await signIn()),
  };
  const post = (path: string, body: unknown) =>
    app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
  const handle = createScaleSubscriber({
    database,
    topic: BASE,
    questionKinds,
    clock,
    users: new Map([["alex", admin.id]]),
  });
  await auth.rejection(
    await post("/api/weights", {
      client_id: "scale:alex:2026-03-10T20:00:00.000Z",
      weight_kg: 72,
    }),
    400,
    "invalid_request",
  );
  for (const hour of [19, 20, 21])
    await handle(
      Buffer.from(JSON.stringify(fixture(`2026-03-10T${hour}:00:00Z`, 72))),
      `${BASE}/alex`,
    );
  database.exec("UPDATE users SET timezone = 'UTC'");
  const questions = database
    .prepare("SELECT id FROM questions ORDER BY id")
    .pluck()
    .all();
  assert.equal(questions.length, 2);
  for (const [index, id] of questions.entries()) {
    const keep = index === 0;
    const response = await post("/api/questions/answer", {
      id,
      answer: { keep },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      id,
      status: "answered",
      weight_logged: keep,
    });
    await auth.rejection(
      await post("/api/questions/answer", { id, answer: { keep } }),
      409,
      "already_answered",
    );
  }
  assert.deepEqual(
    database.prepare("SELECT day FROM weights ORDER BY id").pluck().all(),
    ["2026-03-11", "2026-03-11"],
  );
});

test("unmapped and out-of-range readings become questions and stay judged", async () => {
  const scale = setup();
  const stray = fixture("2026-03-01T07:00:00Z", 70);
  assert.equal(await scale.send(stray, `${BASE}/guest`), "question_unmapped");
  assert.equal(await scale.send(stray, `${BASE}/guest`), "duplicate");
  scale.remap(new Map(Object.entries({ alex: 1, guest: 2 })));
  assert.equal(await scale.send(stray, `${BASE}/guest`), "duplicate");
  const low = fixture("2026-03-02T07:00:00Z", 19.9);
  const high = fixture("2026-03-03T07:00:00Z", 350.5);
  const asked = ["question_implausible", "question_implausible"];
  assert.deepEqual(await scale.sends(low, high), asked);
  assert.deepEqual(
    scale.questions().map((question) => `${question.kind} ${question.user_id}`),
    ["scale_unmapped null", "scale_implausible 1", "scale_implausible 1"],
  );
  assert.equal(scale.weights().length, 0);
});

test("shape mismatches are counted and write nothing; the status topic is ignored", async () => {
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
    assert.equal(await scale.send(body, topic), "invalid_input");
  assert.equal(await scale.send("offline", `${BASE}/status`), "ignored");
  assert.deepEqual(
    scale.logs.map((line) => line.replace("scale_reading_invalid ", "")),
    [
      ...["not_json 1", "not_object 1", "bad_weight 1", "bad_weight 2"],
      ...["bad_timestamp 1", "bad_body_fat 1", "missing_slug 1", "not_json 2"],
    ],
  );
  assert.equal(scale.questions().length + scale.weights().length, 0);
  assert.equal(await scale.send(good), "logged");
});

test("scale settings fail startup when invalid and need a mapping to enable", () => {
  for (const users of [
    '{"alex":"example-alex","sam":"example-alex"}',
    '{"status":"example-alex"}',
    '{"alex/two":"example-alex"}',
  ])
    assert.throws(() => load({ TARE_SCALE_USERS: users }), /distinct/);
  const nobody = '{"alex":"nobody"}';
  const noUrl = { TARE_SCALE_USERS: nobody, TARE_MQTT_URL: "" };
  assert.throws(() => load(noUrl), /requires TARE_MQTT_URL/);
  assert.equal(load({ TARE_SCALE_TOPIC: "scales" }).scale, null);
  const scale = { topic: BASE, users: { alex: "nobody" } };
  assert.deepEqual(load({ TARE_SCALE_USERS: nobody }).scale, scale);
  assert.throws(() => resolveScaleUsers(setup().database, scale), /unknown/);
});

async function brokerFixture(context: TestContext) {
  const broker = (await Aedes.createBroker()) as Aedes & {
    clients: Record<
      string,
      { id: string; conn: { destroy(): void }; _nextId: number }
    >;
  };
  const server = createServer(broker.handle).listen(0);
  await once(server, "listening");
  const url = `mqtt://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const producer = await connectAsync(url);
  context.after(async () => {
    await producer.endAsync();
    await new Promise((done) => broker.close(() => server.close(done)));
  });
  return { broker, producer, url };
}

test("two scale users land in their own weights over MQTT and survive a reconnect", async (context) => {
  const { broker, producer, url } = await brokerFixture(context);
  const scale = setup();
  const users = { alex: "example-alex", sam: "example-sam" };
  scale.remap(resolveScaleUsers(scale.database, { topic: BASE, users }));
  const publisher = createHomeAssistantPublisher({
    database: scale.database,
    config: load({ TARE_MQTT_URL: url }).mqtt as MqttConfig,
    clientOptions: { reconnectPeriod: 10 },
  });
  context.after(() => publisher.stop());
  const results: string[] = [];
  publisher.subscribe(`${BASE}/+`, async (payload, topic) => {
    results.push(await scale.send(payload.toString(), topic));
  });
  const retained = { retain: true, qos: 1 } as const;
  for (const [slug, weight] of Object.entries({ alex: 72, sam: 64 })) {
    const body = JSON.stringify(fixture("2026-03-01T07:00:00Z", weight));
    await producer.publishAsync(`${BASE}/${slug}`, body, retained);
  }
  while (results.length < 2) await setImmediate();
  for (const client of Object.values(broker.clients))
    if (client.id.startsWith("tare-")) client.conn.destroy();
  while (results.length < 4) await setImmediate();
  assert.deepEqual(results, ["logged", "logged", "duplicate", "duplicate"]);
  const owners = scale.weights().map((row) => row.slice(0, 2).join());
  assert.deepEqual(owners, ["1,72", "2,64"]);
});

test("MQTT ACK follows a successful BUSY retry or a logged terminal failure", async (context) => {
  const file = join(scratch(context), "test.sqlite");
  const connection = openDatabase(file);
  const lock = new Database(file);
  const { broker, producer, url } = await brokerFixture(context);
  const steps = new EventEmitter();
  let advance: (() => void) | undefined;
  let closing = false;
  const scale = setup(
    connection.database,
    () =>
      new Promise<void>((resolve) => {
        advance = resolve;
        if (closing) resolve();
        else steps.emit("retry", resolve);
      }),
  );
  const publisher = createHomeAssistantPublisher({
    database: scale.database,
    config: load({ TARE_MQTT_URL: url }).mqtt as MqttConfig,
  });
  context.after(async () => {
    if (lock.inTransaction) lock.exec("ROLLBACK");
    closing = true;
    advance?.();
    await publisher.stop();
    lock.close();
    connection.close();
  });
  const subscribed = once(broker, "subscribe");
  const topic = `${BASE}/alex`;
  publisher.subscribe(topic, (payload, received) =>
    scale.send(payload.toString(), received),
  );
  await subscribed;
  const settlements: { weights: number; log: string | undefined }[] = [];
  broker.on("ack", (_packet, client) => {
    if (client.id.startsWith("tare-")) {
      settlements.push({
        weights: scale.weights().length,
        log: scale.logs.at(-1),
      });
      steps.emit("ack");
    }
  });
  for (const [index, succeeds] of [true, false].entries()) {
    lock.exec("BEGIN IMMEDIATE");
    let retry = once(steps, "retry");
    const ack = once(steps, "ack");
    const at = `2026-03-1${index}T08:00:00.000Z`;
    await producer.publishAsync(topic, JSON.stringify(fixture(at, 72)), {
      qos: 1,
    });
    for (const attempt of [1, 2, 3, 4]) {
      const [next] = await retry;
      assert.equal(settlements.length, index);
      if (succeeds) lock.exec("ROLLBACK");
      else if (attempt < 4) retry = once(steps, "retry");
      next();
      if (succeeds) break;
    }
    await ack;
    assert.deepEqual(settlements[index], {
      weights: 1,
      log: succeeds
        ? undefined
        : `scale_reading_failed SQLITE_BUSY 72 kg at ${at}`,
    });
  }
  lock.exec("ROLLBACK");
  scale.database.exec(
    "CREATE TRIGGER reject_test_weight BEFORE INSERT ON weights BEGIN SELECT raise(ABORT, 'test'); END",
  );
  const ack = once(steps, "ack");
  const at = "2026-03-12T08:00:00.000Z";
  await producer.publishAsync(topic, JSON.stringify(fixture(at, 72)), {
    qos: 1,
  });
  await ack;
  assert.deepEqual(settlements[2], {
    weights: 1,
    log: `scale_reading_failed SQLITE_CONSTRAINT_TRIGGER 72 kg at ${at}`,
  });
});

test("a BUSY retry cannot acknowledge a reused packet ID on a replacement connection", async (context) => {
  const file = join(scratch(context), "reconnect.sqlite");
  const connection = openDatabase(file);
  const lock = new Database(file);
  const { broker, producer, url } = await brokerFixture(context);
  const steps = new EventEmitter();
  const pending = new Set<() => void>();
  let closing = false;
  const scale = setup(connection.database, () => {
    if (closing) return Promise.resolve();
    return new Promise<void>((resolve) => {
      pending.add(resolve);
      steps.emit("retry", resolve);
    });
  });
  const incoming: number[] = [];
  const outgoing: number[] = [];
  const publisher = createHomeAssistantPublisher({
    database: scale.database,
    config: load({ TARE_MQTT_URL: url }).mqtt as MqttConfig,
    clientOptions: {
      reconnectPeriod: 10,
      log(format, packet) {
        if (
          format === "handlePublish: packet %o" &&
          packet.topic === `${BASE}/alex`
        )
          incoming.push(packet.messageId);
        if (format === "_writePacket :: packet: %O" && packet.cmd === "puback")
          outgoing.push(packet.messageId);
      },
    },
  });
  context.after(async () => {
    closing = true;
    if (lock.inTransaction) lock.exec("ROLLBACK");
    for (const resume of pending) resume();
    await publisher.stop();
    lock.close();
    connection.close();
  });
  publisher.subscribe(`${BASE}/alex`, async (payload, topic) => {
    const result = await scale.send(payload.toString(), topic);
    steps.emit("settled", result);
  });
  let subscribed = once(broker, "subscribe");
  const send = async (hour: string) => {
    await subscribed;
    const receiver = Object.values(broker.clients).find((client) =>
      client.id.startsWith("tare-"),
    );
    assert.ok(receiver);
    receiver._nextId = 300;
    const retry = once(steps, "retry");
    await producer.publishAsync(
      `${BASE}/alex`,
      JSON.stringify(fixture(`2026-03-10T${hour}:00:00Z`, 72)),
      { qos: 1 },
    );
    const [resume] = await retry;
    return { receiver, resume };
  };
  lock.exec("BEGIN IMMEDIATE");
  const first = await send("07");
  subscribed = once(broker, "subscribe");
  first.receiver.conn.destroy();
  const second = await send("08");
  assert.notEqual(first.receiver, second.receiver);
  assert.deepEqual(incoming, [300, 300]);
  lock.exec("ROLLBACK");
  const settled = once(steps, "settled");
  first.resume();
  assert.deepEqual(await settled, ["logged"]);
  await setImmediate();
  assert.deepEqual(outgoing, []);

  const acknowledged = once(broker, "ack");
  second.resume();
  await acknowledged;
  assert.deepEqual(outgoing, [300]);
  assert.equal(scale.weights().length, 1);
  assert.equal(scale.questions().length, 1);
});
