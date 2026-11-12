import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { openDatabase, writeTransaction } from "../src/db.ts";
import { createGrocyClient } from "../src/grocy/client.ts";
import { insertIntake } from "../src/logging/intake.ts";
import { createPantryDispatcher } from "../src/pantry/dispatch.ts";
import { createPantryStock, recoverRequests } from "../src/pantry/requests.ts";
import { createPantryService } from "../src/pantry/service.ts";
import { test } from "./support/hang-ceiling.ts";

const config = {
  url: "http://grocy/api",
  apiKey: "invented-secret",
  username: "example-owner",
};
const clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };
const unit = { id: 2, name: "can", name_plural: null };
const product = {
  id: 7,
  name: "Synthetic beans",
  qu_id_stock: 2,
  enable_tare_weight_handling: 0,
};

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(context: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "tare-dispatch-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "tare.sqlite");
  const connection = openDatabase(path);
  const { database } = connection;
  const user = (username: string) =>
    Number(
      database
        .prepare(
          "INSERT INTO users (username, timezone, is_admin, created_at) VALUES (?, 'UTC', 0, ?)",
        )
        .run(username, clock.now().toISOString()).lastInsertRowid,
    );
  const ownerId = user("example-owner");
  const memberId = user("example-member");
  const food = Number(
    database
      .prepare(
        "INSERT INTO foods (user_id, name, provenance) VALUES (?, 'Synthetic soup', 'label')",
      )
      .run(ownerId).lastInsertRowid,
  );
  const grocy = {
    catalog: [{ id: 7, name: product.name, qu_id_stock: 2, active: 1 }],
    detail: { product, quantity_unit_stock: unit } as unknown,
    detailStatus: 200,
    calls: [] as string[],
    stockHold: undefined as Promise<void> | undefined,
    onStock: () => {},
    detailHold: undefined as Promise<void> | undefined,
    onDetail: () => {},
    consume: (amount: number): Promise<Response> | Response =>
      Response.json([
        {
          id: 1,
          transaction_id: "synthetic-transaction",
          product_id: 7,
          transaction_type: "consume",
          amount: -amount,
        },
      ]),
  };
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const route = new URL(String(url)).pathname.replace("/api", "");
    grocy.calls.push(route);
    if (route.endsWith("/consume"))
      return grocy.consume(
        JSON.parse(await new Response(init?.body).text()).amount,
      );
    if (route === "/stock") {
      grocy.onStock();
      await grocy.stockHold;
      return Response.json([]);
    }
    if (route === "/objects/products") return Response.json(grocy.catalog);
    grocy.onDetail();
    await grocy.detailHold;
    return Response.json(grocy.detail, { status: grocy.detailStatus });
  };
  const client = createGrocyClient({ config, ownerId, fetch });
  const service = createPantryService({
    database,
    config,
    ownerId,
    clock,
    client,
  });
  database
    .prepare(
      "INSERT INTO pantry_bindings VALUES (?, 1, 'food', ?, 7, 2, 0.5, 'valid', 'token')",
    )
    .run(ownerId, food);
  const reports: string[] = [];
  const dispatcherOn = (target = database) =>
    createPantryDispatcher({
      database: target,
      config,
      ownerId,
      clock,
      client,
      refresh: service.refreshAfterDelivery,
      report: (code) => reports.push(code),
    });
  const dispatcher = dispatcherOn();
  const stock = createPantryStock({
    config,
    ownerId,
    clock,
    kick: dispatcher.kick,
    report: assert.fail,
  });
  const log = (clientId: string) =>
    writeTransaction(database, (scope) =>
      insertIntake(
        scope,
        {
          id: ownerId,
          username: "example-owner",
          is_admin: 0,
          timezone: "UTC",
          day_start_hour: 0,
        },
        {
          client_id: clientId,
          reference: { kind: "food", id: food },
          servings: 2,
          claim: {},
        },
        clock,
        stock,
      ),
    ).stock?.request_id ?? "";
  const request = (id: string) =>
    database
      .prepare("SELECT state, reason FROM pantry_requests WHERE id = ?")
      .get(id) as { state: string; reason: string | null } | undefined;
  const consumes = () =>
    grocy.calls.filter((route) => route.endsWith("/consume")).length;
  context.after(async () => {
    await Promise.all([dispatcher.stop(), service.stop()]);
    connection.close();
  });
  return {
    database,
    path,
    ownerId,
    memberId,
    grocy,
    service,
    reports,
    dispatcher,
    dispatcherOn,
    log,
    request,
    consumes,
  };
}

test("a committed request is sent once and the snapshot refetches after delivery", async (context) => {
  const {
    grocy,
    service,
    ownerId,
    dispatcher,
    log,
    request,
    consumes,
    reports,
  } = setup(context);
  let id = "";
  const seen: (string | undefined)[] = [];
  const first = deferred();
  const second = deferred();
  grocy.onStock = () => {
    seen.push(request(id)?.state);
    (seen.length === 1 ? first : second).resolve();
  };
  const earlier = deferred();
  grocy.stockHold = earlier.promise;
  const inFlight = service.refresh(ownerId);
  await first.promise;
  id = log("first");
  await dispatcher.job.run();
  assert.deepEqual(request(id), { state: "delivered", reason: null });
  earlier.resolve();
  await inFlight;
  // The flight that began before delivery cannot show the consume, so a later one must start.
  await second.promise;
  await service.stop();
  assert.deepEqual(seen, [undefined, "delivered"]);
  assert.deepEqual(reports, []);
  await dispatcher.job.run();
  assert.equal(consumes(), 1);
});

test("requests owned by another user are never sent", async (context) => {
  const { database, memberId, dispatcher, grocy, request } = setup(context);
  const id = "00000000-0000-4000-8000-000000000001";
  database
    .prepare(
      "INSERT INTO pantry_requests (id, user_id, generation, client_id, reference_kind, reference_id, product_id, stock_unit_id, quantity_per_serving, quantity, state, created_at) VALUES (?, ?, 1, 'member', 'food', 1, 7, 2, 0.5, 1, 'pending', ?)",
    )
    .run(id, memberId, clock.now().toISOString());
  await dispatcher.job.run();
  assert.deepEqual(grocy.calls, []);
  assert.equal(request(id)?.state, "pending");
});

test("competing dispatchers on separate connections send a request once", async (context) => {
  const { path, dispatcher, dispatcherOn, log, request, consumes } =
    setup(context);
  const second = openDatabase(path);
  context.after(second.close);
  const id = log("competing");
  await Promise.all([
    dispatcher.job.run(),
    dispatcherOn().job.run(),
    dispatcherOn(second.database).job.run(),
  ]);
  assert.equal(consumes(), 1);
  assert.equal(request(id)?.state, "delivered");
});

test("a refused connection after dispatch is uncertain and never resent", async (context) => {
  const { grocy, dispatcher, log, request, consumes, reports } = setup(context);
  grocy.consume = () => {
    throw new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }),
    });
  };
  const id = log("refused");
  await dispatcher.job.run();
  await dispatcher.job.run();
  assert.deepEqual(request(id), { state: "uncertain", reason: "transport" });
  assert.equal(consumes(), 1);
  assert.deepEqual(reports, ["pantry_consume_unconfirmed"]);
});

test("a dropped response before restart leaves one uncertain consume", async (context) => {
  const {
    path,
    grocy,
    dispatcher,
    dispatcherOn,
    log,
    request,
    consumes,
    reports,
  } = setup(context);
  const sent = deferred();
  const dropped = deferred<Response>();
  grocy.consume = () => {
    sent.resolve();
    return dropped.promise;
  };
  const id = log("dropped");
  await sent.promise;
  const restarted = openDatabase(path);
  context.after(restarted.close);
  recoverRequests(restarted.database, clock);
  await dispatcherOn(restarted.database).job.run();
  dropped.resolve(Response.error());
  await dispatcher.job.run();
  assert.deepEqual(request(id), { state: "uncertain", reason: "restarted" });
  assert.equal(consumes(), 1);
  assert.deepEqual(reports, ["pantry_finalize_failed"]);
});

test("a product changed, deleted or unreadable before send is never consumed", async (context) => {
  const { grocy, dispatcher, log, request, consumes, reports } = setup(context);
  grocy.detailStatus = 500;
  const unreadable = log("unreadable");
  await dispatcher.job.run();
  assert.equal(request(unreadable)?.state, "pending");
  assert.deepEqual(reports, ["pantry_read_failed"]);
  grocy.detailStatus = 200;
  grocy.detail = {
    product: { ...product, qu_id_stock: 3 },
    quantity_unit_stock: { ...unit, id: 3 },
  };
  await dispatcher.job.run();
  assert.deepEqual(request(unreadable), {
    state: "rejected",
    reason: "unit_mismatch",
  });
  grocy.detail = { product, quantity_unit_stock: unit };
  grocy.detailStatus = 404;
  const gone = log("gone");
  await dispatcher.job.run();
  assert.deepEqual(request(gone), {
    state: "rejected",
    reason: "product_missing",
  });
  grocy.catalog = [];
  const deleted = log("deleted");
  await dispatcher.job.run();
  assert.deepEqual(request(deleted), {
    state: "rejected",
    reason: "product_missing",
  });
  assert.equal(consumes(), 0);
});

test("stop admits no new claims and drains the send in flight", async (context) => {
  const { grocy, service, dispatcher, dispatcherOn, log, request, consumes } =
    setup(context);
  const sent = deferred();
  const answer = deferred();
  const confirm = grocy.consume;
  grocy.consume = (amount) => {
    sent.resolve();
    return answer.promise.then(() => confirm(amount));
  };
  const inFlight = log("in-flight");
  const waiting = log("waiting");
  await sent.promise;
  let drained = false;
  const stopped = Promise.all([dispatcher.stop(), service.stop()]).then(() => {
    drained = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);
  answer.resolve();
  await stopped;
  // Equal timestamps leave the send order to the random request ids.
  assert.deepEqual([request(inFlight)?.state, request(waiting)?.state].sort(), [
    "delivered",
    "pending",
  ]);
  assert.equal(consumes(), 1);
  assert.equal(
    grocy.calls.filter((route) => route === "/stock/products/7").length,
    1,
  );
  // A stop that lands during the pre-send read still admits no claim.
  const reading = deferred();
  const held = deferred();
  grocy.onDetail = reading.resolve;
  grocy.detailHold = held.promise;
  const late = dispatcherOn();
  const lateRun = late.job.run();
  await reading.promise;
  const lateStopped = late.stop();
  held.resolve();
  await Promise.all([lateRun, lateStopped]);
  assert.equal(consumes(), 1);
});
