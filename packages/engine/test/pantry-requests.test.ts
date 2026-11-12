import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { createBackupJob } from "../src/backup.ts";
import { afterCommit, openDatabase, writeTransaction } from "../src/db.ts";
import { insertIntake } from "../src/logging/intake.ts";
import * as requests from "../src/pantry/requests.ts";
import { createPantryService } from "../src/pantry/service.ts";
import { deleteIntake } from "../src/queries/delete-intake.ts";
import { insertAccount } from "../src/queries/insert-account.ts";
import { readRequest } from "../src/queries/pantry/read-request.ts";
import { saveBinding } from "../src/queries/pantry/save-binding.ts";
import { test } from "./support/hang-ceiling.ts";

const config = {
  url: "http://grocy/api",
  apiKey: "invented-secret",
  username: "example-owner",
};
const clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };

function setup(context: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "tare-requests-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "tare.sqlite");
  const connection = openDatabase(path);
  context.after(connection.close);
  const { database } = connection;
  const person = (username: string) => {
    const account = insertAccount(database, {
      ...{ username, password_hash: null, access_email: null, timezone: "UTC" },
      ...{ is_admin: 0, created_at: clock.now().toISOString() },
    });
    assert.ok(account);
    const insertFood = database.prepare(
      "INSERT INTO foods (user_id, name, provenance) VALUES (?, 'Synthetic soup', 'label')",
    );
    return {
      ...account,
      food: Number(insertFood.run(account.id).lastInsertRowid),
    };
  };
  const owner = person("example-owner");
  const member = person("example-member");
  const service = createPantryService({
    database,
    config,
    ownerId: owner.id,
    clock,
  });
  const bind = (generation: number) =>
    saveBinding(database, {
      ...{
        user_id: owner.id,
        generation,
        reference_kind: "food",
        reference_id: owner.food,
      },
      ...{
        product_id: 7,
        stock_unit_id: 2,
        quantity_per_serving: 0.5,
        change_token: "token",
      },
    });
  bind(1);
  const kicks: string[] = [];
  const stock = requests.createPantryStock({
    ...{ config, ownerId: owner.id, clock, report: assert.fail },
    kick: () => kicks.push("kick"),
  });
  const intake = (who: typeof owner, client_id: string) => ({
    ...{ client_id, servings: 2, claim: {} },
    reference: { kind: "food" as const, id: who.food },
  });
  const log = (who: typeof owner, client_id: string, effect = stock) =>
    writeTransaction(database, (scope) =>
      insertIntake(scope, who, intake(who, client_id), clock, effect),
    );
  const identity = {
    user_id: owner.id,
    generation: 1,
    url: config.url,
    username: config.username,
  };
  const key = (id?: string | null) => ({
    id: id ?? "",
    product_id: 7,
    stock_unit_id: 2,
  });
  return {
    ...{ database, path, directory, owner, member, service, bind, kicks },
    ...{ intake, log, identity, key },
    request: (id?: string | null) => readRequest(database, { id: id ?? "" })[0],
    claim: (id?: string | null) =>
      requests.claimRequest(database, key(id), identity, clock),
  };
}

test("intake records one request or a safe reason in its own transaction", (context) => {
  const { database, owner, member, bind, kicks, intake, log, request } =
    setup(context);
  const suppressed = writeTransaction(database, (scope) =>
    insertIntake(scope, owner, intake(owner, "suppressed"), clock, "suppress"),
  );
  assert.deepEqual(Object.keys(suppressed), ["entry", "created"]);
  const disabled = requests.createPantryStock({
    config: null,
    ownerId: null,
    clock,
    report: assert.fail,
  });
  assert.deepEqual(log(owner, "disabled", disabled).stock, {
    ...{ generation: null, request_id: null, reason: "disabled", state: null },
  });
  assert.equal(log(member, "member").stock?.reason, "not_owner");
  const created = log(owner, "created");
  assert.deepEqual(
    [created.stock?.state, request(created.stock?.request_id)?.quantity],
    ["pending", 1],
  );
  const replay = log(owner, "created");
  assert.deepEqual(
    [replay.created, replay.stock, kicks],
    [false, created.stock, ["kick"]],
  );
  assert.equal(log(owner, "suppressed").stock, null);
  assert.throws(() =>
    writeTransaction(database, (scope) => {
      insertIntake(
        scope,
        owner,
        intake(owner, "rolled-back"),
        clock,
        requests.createPantryStock({
          ...{
            config,
            ownerId: owner.id,
            clock,
            kick: assert.fail,
            report: assert.fail,
          },
        }),
      );
      throw new Error("rollback");
    }),
  );
  database.prepare("UPDATE pantry_bindings SET status = 'tare_enabled'").run();
  assert.equal(log(owner, "tare").stock?.reason, "tare_enabled");
  database.prepare("DELETE FROM pantry_bindings").run();
  assert.equal(log(owner, "unbound").stock?.reason, "no_binding");
  bind(1);
  database.prepare("UPDATE pantry_connection SET reset_required = 1").run();
  assert.equal(log(owner, "latched").stock?.reason, "reset_required");
  assert.deepEqual(database.prepare("SELECT id FROM pantry_requests").all(), [
    { id: created.stock?.request_id },
  ]);
});

test("deleted, reused and replayed intakes never create a second request", (context) => {
  const { database, owner, service, bind, log, request, claim } =
    setup(context);
  const servings = (id: number, value: number) =>
    database
      .prepare("UPDATE intake_entries SET servings = ? WHERE id = ?")
      .run(value, id);
  const first = log(owner, "first");
  deleteIntake(database, { user_id: owner.id, id: first.entry.id });
  const detached = request(first.stock?.request_id);
  assert.deepEqual([detached?.state, detached?.intake_id], ["cancelled", null]);
  assert.equal(JSON.parse(detached?.detached_intake ?? "{}").servings, 2);
  const reused = log(owner, "second");
  assert.equal(reused.entry.id, first.entry.id);
  assert.notEqual(reused.stock?.request_id, first.stock?.request_id);
  const attempted = claim(reused.stock?.request_id);
  assert.ok(attempted);
  requests.finalizeClaim(
    database,
    attempted,
    { status: "not_sent", reason: "transport" },
    clock,
  );
  servings(reused.entry.id, 4);
  const edited = request(reused.stock?.request_id);
  assert.deepEqual(
    [edited?.state, edited?.quantity, edited?.edited_servings],
    ["pending", 1, 4],
  );
  deleteIntake(database, { user_id: owner.id, id: reused.entry.id });
  assert.equal(request(reused.stock?.request_id)?.state, "cancelled");
  service.reset(owner.id, true);
  bind(2);
  const replayed = log(owner, "first");
  assert.deepEqual(
    [replayed.stock?.request_id, replayed.stock?.generation],
    [first.stock?.request_id, 2],
  );
  const unattempted = log(owner, "third");
  servings(unattempted.entry.id, 3);
  assert.equal(request(unattempted.stock?.request_id)?.quantity, 1.5);
});

test("claims are exclusive, conditional and finalized only by their own token", (context) => {
  const { database, path, owner, log, request, identity, key, claim } =
    setup(context);
  const other = openDatabase(path);
  context.after(other.close);
  const ids = ["a", "b", "c", "d", "e", "f"].map(
    (client) => log(owner, client).stock?.request_id,
  );
  const won = claim(ids[0]);
  assert.ok(won);
  assert.equal(
    requests.claimRequest(other.database, key(ids[0]), identity, clock),
    null,
  );
  assert.equal(
    requests.finalizeClaim(
      database,
      { ...won, claim_token: "stale" },
      undefined,
      clock,
    ),
    false,
  );
  const booking = {
    id: 3,
    transaction_id: "x1",
    product_id: 7,
    transaction_type: "consume" as const,
    amount: -1,
  };
  const cases = [
    [{ status: "confirmed", value: [booking] }, "delivered", null],
    [
      { status: "confirmed", value: [{ ...booking, product_id: 8 }] },
      "uncertain",
      "invalid_response",
    ],
    [
      { status: "rejected", reason: "http", httpStatus: 400 },
      "rejected",
      "http",
    ],
    [{ status: "uncertain", reason: "transport" }, "uncertain", "transport"],
    [undefined, "uncertain", "response_withheld"],
  ] as const;
  for (const [index, [result, state, reason]] of cases.entries()) {
    const held: requests.Claim | null = index === 0 ? won : claim(ids[index]);
    assert.ok(held);
    assert.equal(
      requests.finalizeClaim(other.database, held, result as never, clock),
      true,
    );
    assert.deepEqual(
      [request(held.id)?.state, request(held.id)?.reason],
      [state, reason],
    );
  }
  const receipt = database.prepare(
    "SELECT outcome, receipt FROM pantry_attempts WHERE request_id = ?",
  );
  assert.deepEqual(receipt.get(ids[0]), {
    outcome: "confirmed",
    receipt: '[{"id":3,"transaction_id":"x1"}]',
  });
  const reject = (change: object, current = identity) =>
    requests.rejectRequest(
      database,
      { ...key(ids[5]), ...change },
      current,
      "unit_mismatch",
    );
  assert.deepEqual(
    [
      reject({ stock_unit_id: 3 }),
      reject({}, { ...identity, generation: 2 }),
      reject({}),
      claim(ids[5]),
    ],
    [false, false, true, null],
  );
});

test("backup copies are marked and restart treats possibly sent work as uncertain", async (context) => {
  const { database, directory, owner, log, request, claim } = setup(context);
  const pending = log(owner, "pending").stock?.request_id;
  const sending = log(owner, "sending").stock?.request_id;
  assert.ok(claim(sending));
  const copies = join(directory, "copies");
  const job = createBackupJob({ database, directory: copies, keep: 1, clock });
  await job.run({ signal: new AbortController().signal });
  const copyPath = join(copies, readdirSync(copies)[0] ?? "");
  const markers = "SELECT * FROM pantry_backup_marker";
  assert.deepEqual(
    [existsSync(`${copyPath}-wal`), database.prepare(markers).all()],
    [false, []],
  );
  const restored = openDatabase(copyPath);
  context.after(restored.close);
  requests.recoverRequests(restored.database, clock);
  const reason = (id?: string | null) =>
    readRequest(restored.database, { id: id ?? "" })[0]?.reason;
  assert.deepEqual(
    [reason(pending), reason(sending)],
    ["restored_backup", "restored_backup"],
  );
  assert.deepEqual(restored.database.prepare(markers).all(), []);
  requests.recoverRequests(database, clock);
  assert.deepEqual(
    [
      request(pending)?.state,
      request(sending)?.state,
      request(sending)?.reason,
    ],
    ["pending", "uncertain", "restarted"],
  );
});

test("reset refuses unresolved requests and otherwise cancels pending work", (context) => {
  const { database, owner, member, service, log, request, claim } =
    setup(context);
  const pending = log(owner, "pending").stock?.request_id;
  const uncertain = log(owner, "uncertain").stock?.request_id;
  const held = claim(uncertain);
  assert.ok(held);
  requests.finalizeClaim(
    database,
    held,
    { status: "uncertain", reason: "timeout" },
    clock,
  );
  const move =
    "UPDATE pantry_requests SET user_id = ?, intake_id = NULL WHERE id = ?";
  database.prepare(move).run(member.id, uncertain);
  assert.deepEqual(service.read(owner.id).requested, [
    { product_id: 7, stock_unit_id: 2, pending: 1, sending: 0, uncertain: 0 },
  ]);
  assert.throws(
    () => service.reset(owner.id, true),
    /pantry_requests_unresolved/,
  );
  const bindings = database
    .prepare("SELECT product_id FROM pantry_bindings")
    .all();
  assert.deepEqual(
    [service.read(owner.id).state, request(pending)?.state, bindings],
    ["reset_required", "pending", [{ product_id: 7 }]],
  );
  database
    .prepare("UPDATE pantry_requests SET state = 'delivered' WHERE id = ?")
    .run(uncertain);
  const reset = service.reset(owner.id);
  assert.deepEqual(
    [reset.generation, reset.requested, request(pending)?.state],
    [2, [], "cancelled"],
  );
});

test("afterCommit runs isolated callbacks only after a successful commit", async (context) => {
  const { database } = setup(context);
  const events: string[] = [];
  const fail = (name: string) => () => events.push(`${name} failed`);
  const result = writeTransaction(database, (scope) => {
    afterCommit(scope, () => JSON.parse("{"), fail("sync"));
    afterCommit(scope, () => Promise.reject(new Error("async")), fail("async"));
    afterCommit(scope, () => events.push("later"), assert.fail);
    events.push("inside");
    return "value";
  });
  await Promise.resolve();
  assert.deepEqual(
    [result, events],
    ["value", ["inside", "sync failed", "later", "async failed"]],
  );
  let closed: Parameters<typeof afterCommit>[0] | undefined;
  assert.throws(() =>
    writeTransaction(database, (scope) => {
      closed = scope;
      afterCommit(scope, assert.fail, assert.fail);
      throw new Error("rollback");
    }),
  );
  assert.throws(
    () => afterCommit(closed as never, assert.fail, assert.fail),
    /Inactive/,
  );
});
