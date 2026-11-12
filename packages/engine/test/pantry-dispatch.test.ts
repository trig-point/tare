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
import { grocy as config, grocyFetch } from "./support/pantry-fake.ts";

const clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };
const unit = { id: 2, name: "can", name_plural: null };
const product = {
  id: 7,
  name: "Synthetic beans",
  qu_id_stock: 2,
  enable_tare_weight_handling: 0,
};
const detail = "/stock/products/:id";
const consume = "/stock/products/:id/consume";
const confirm = ({ body }: { body: unknown }) => [
  {
    id: 1,
    transaction_id: "synthetic-transaction",
    product_id: 7,
    transaction_type: "consume",
    amount: -(body as { amount: number }).amount,
  },
];

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
  const ownerId = user(config.username);
  const memberId = user("example-member");
  const food = Number(
    database
      .prepare(
        "INSERT INTO foods (user_id, name, provenance) VALUES (?, 'Synthetic soup', 'label')",
      )
      .run(ownerId).lastInsertRowid,
  );
  const grocy = grocyFetch({
    "/objects/products": [
      { id: 7, name: product.name, qu_id_stock: 2, active: 1 },
    ],
    [detail]: { product, quantity_unit_stock: unit },
    "/stock": [],
    [consume]: confirm,
  });
  const client = createGrocyClient({ config, ownerId, fetch: grocy.fetch });
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
          username: config.username,
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
  const first = Promise.withResolvers<void>();
  const earlier = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  grocy.routes["/stock"] = async () => {
    seen.push(request(id)?.state);
    if (seen.length === 1) {
      first.resolve();
      await earlier.promise;
    } else second.resolve();
    return [];
  };
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
  grocy.routes[consume] = () => {
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
  const sent = grocy.hold(/consume$/);
  const id = log("dropped");
  await sent.reached;
  const restarted = openDatabase(path);
  context.after(restarted.close);
  recoverRequests(restarted.database, clock);
  await dispatcherOn(restarted.database).job.run();
  grocy.routes[consume] = () => Response.error();
  sent.release();
  await assert.rejects(dispatcher.job.run());
  assert.deepEqual(request(id), { state: "uncertain", reason: "restarted" });
  assert.equal(consumes(), 1);
  assert.deepEqual(reports, ["pantry_finalize_failed"]);
});

test("a product changed, deleted or unreadable before send is never consumed", async (context) => {
  const { grocy, dispatcher, log, request, consumes, reports } = setup(context);
  grocy.routes[detail] = () => Response.json({}, { status: 500 });
  const unreadable = log("unreadable");
  await assert.rejects(dispatcher.job.run());
  assert.equal(request(unreadable)?.state, "pending");
  assert.deepEqual(reports, ["pantry_read_failed"]);
  const rejects = async (id: string, routes: object) => {
    Object.assign(grocy.routes, routes);
    await dispatcher.job.run();
    return request(id);
  };
  const changed = {
    product: { ...product, qu_id_stock: 3 },
    quantity_unit_stock: { ...unit, id: 3 },
  };
  assert.deepEqual(
    [
      await rejects(unreadable, { [detail]: changed }),
      await rejects(log("gone"), {
        [detail]: () => Response.json({}, { status: 404 }),
      }),
      await rejects(log("deleted"), {
        [detail]: { product, quantity_unit_stock: unit },
        "/objects/products": [],
      }),
    ],
    [
      { state: "rejected", reason: "unit_mismatch" },
      { state: "rejected", reason: "product_missing" },
      { state: "rejected", reason: "product_missing" },
    ],
  );
  assert.equal(consumes(), 0);
});

test("stop admits no new claims and drains the send in flight", async (context) => {
  const { grocy, service, dispatcher, dispatcherOn, log, request, consumes } =
    setup(context);
  const answer = grocy.hold(/consume$/);
  const inFlight = log("in-flight");
  const waiting = log("waiting");
  await answer.reached;
  const held = () =>
    [inFlight, waiting].filter((id) => dispatcher.holds(id ?? "", 1)).length;
  assert.equal(held(), 1);
  let drained = false;
  const stopped = Promise.all([dispatcher.stop(), service.stop()]).then(() => {
    drained = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);
  answer.release();
  await stopped;
  assert.equal(held(), 0);
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
  const reading = grocy.hold("/stock/products/7");
  const late = dispatcherOn();
  const lateRun = late.job.run();
  await reading.reached;
  const lateStopped = late.stop();
  reading.release();
  await Promise.all([lateRun, lateStopped]);
  assert.equal(consumes(), 1);
});
