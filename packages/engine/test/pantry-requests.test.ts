import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { createBackupJob } from "../src/backup.ts";
import { afterCommit, openDatabase, writeTransaction } from "../src/db.ts";
import { insertIntake } from "../src/logging/intake.ts";
import { numbersFrom } from "../src/logging/schemas.ts";
import * as requests from "../src/pantry/requests.ts";
import { createPantryService } from "../src/pantry/service.ts";
import { deleteIntake } from "../src/queries/delete-intake.ts";
import { readRequest } from "../src/queries/pantry/read-request.ts";
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
    const id = Number(
      database
        .prepare(
          "INSERT INTO users (username, timezone, is_admin, created_at) VALUES (?, 'UTC', 0, ?)",
        )
        .run(username, clock.now().toISOString()).lastInsertRowid,
    );
    const food = database
      .prepare(
        "INSERT INTO foods (user_id, name, provenance) VALUES (?, 'Synthetic soup', 'label')",
      )
      .run(id).lastInsertRowid;
    return {
      id,
      username,
      is_admin: 0,
      timezone: "UTC",
      day_start_hour: 0,
      food: Number(food),
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
    database
      .prepare(
        "INSERT INTO pantry_bindings VALUES (?, ?, 'food', ?, 7, 2, 0.5, 'valid', 'token')",
      )
      .run(owner.id, generation, owner.food);
  bind(1);
  const kicks: string[] = [];
  const stock = requests.createPantryStock({
    config,
    ownerId: owner.id,
    clock,
    kick: () => kicks.push("kick"),
    report: assert.fail,
  });
  const log = (
    who: typeof owner,
    client_id: string,
    effect = stock,
    then = () => {},
  ) =>
    writeTransaction(database, (scope) => {
      const result = insertIntake(
        scope,
        who,
        {
          client_id,
          reference: { kind: "food", id: who.food },
          servings: 2,
          claim: {},
        },
        clock,
        effect,
      );
      then();
      return result;
    });
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
    database,
    path,
    directory,
    owner,
    member,
    service,
    bind,
    kicks,
    log,
    identity,
    key,
    request: (id?: string | null) => readRequest(database, { id: id ?? "" })[0],
    claim: (id?: string | null) =>
      requests.claimRequest(database, key(id), identity, clock),
  };
}

test("intake records one request or a safe reason in its own transaction", (context) => {
  const { database, owner, member, bind, kicks, log, request } = setup(context);
  const suppressed = writeTransaction(database, (scope) =>
    insertIntake(
      scope,
      owner,
      {
        client_id: "suppressed",
        name: "Snack",
        numbers: numbersFrom({ kcal: 100 }),
        claim: {},
      },
      clock,
      "suppress",
    ),
  );
  assert.deepEqual(Object.keys(suppressed), ["entry", "created"]);
  const created = log(owner, "created");
  assert.equal(request(created.stock?.request_id)?.quantity, 1);
  const replay = log(owner, "created");
  assert.deepEqual([replay.created, replay.stock], [false, created.stock]);
  assert.throws(
    () =>
      log(owner, "rolled-back", undefined, () => {
        throw new Error("rollback");
      }),
    /rollback/,
  );
  const disabled = requests.createPantryStock({
    config: null,
    ownerId: null,
    clock,
    report: assert.fail,
  });
  const cases = [
    ["disabled", () => log(owner, "disabled", disabled)],
    ["not_owner", () => log(member, "member")],
    ["tare_enabled", "UPDATE pantry_bindings SET status = 'tare_enabled'"],
    ["no_binding", "DELETE FROM pantry_bindings"],
    ["reset_required", "UPDATE pantry_connection SET reset_required = 1"],
  ] as const;
  for (const [reason, change] of cases) {
    if (typeof change === "string") database.prepare(change).run();
    if (reason === "reset_required") bind(1);
    const outcome = (typeof change === "string" ? log(owner, reason) : change())
      .stock;
    assert.deepEqual(outcome, {
      generation: reason === "disabled" ? null : 1,
      request_id: null,
      reason,
      state: null,
    });
  }
  assert.equal(log(owner, "created").stock?.state, "pending");
  assert.deepEqual(kicks, ["kick"]);
  assert.deepEqual(database.prepare("SELECT id FROM pantry_requests").all(), [
    { id: created.stock?.request_id },
  ]);
});

test("deleted, reused and replayed intakes never create a second request", (context) => {
  const { database, owner, service, bind, log, request, claim } =
    setup(context);
  const setServings = database.prepare(
    "UPDATE intake_entries SET servings = ? WHERE id = ?",
  );
  const first = log(owner, "first");
  deleteIntake(database, { user_id: owner.id, id: first.entry.id });
  const detached = request(first.stock?.request_id);
  assert.deepEqual([detached?.state, detached?.intake_id], ["cancelled", null]);
  assert.equal(JSON.parse(detached?.detached_intake ?? "{}").servings, 2);
  const reused = log(owner, "second");
  assert.equal(reused.entry.id, first.entry.id);
  assert.notEqual(reused.stock?.request_id, first.stock?.request_id);
  for (const attempt of [1, 2]) {
    const attempted = claim(reused.stock?.request_id);
    assert.equal(attempted?.attempt_count, attempt);
    if (attempted)
      requests.finalizeClaim(
        database,
        attempted,
        { status: "not_sent", reason: "transport" },
        clock,
      );
  }
  setServings.run(4, reused.entry.id);
  const edited = request(reused.stock?.request_id);
  assert.deepEqual(
    [edited?.state, edited?.quantity, edited?.edited_servings],
    ["pending", 1, 4],
  );
  deleteIntake(database, { user_id: owner.id, id: reused.entry.id });
  assert.equal(request(reused.stock?.request_id)?.state, "cancelled");
  service.reset(owner.id, true);
  assert.deepEqual(log(owner, "first").stock, {
    generation: 1,
    request_id: first.stock?.request_id,
    reason: null,
    state: "cancelled",
  });
  bind(2);
  const unattempted = log(owner, "third");
  setServings.run(3, unattempted.entry.id);
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
      { ...won, claim_token: "x" },
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
    [{ status: "rejected", reason: "http" }, "rejected", "http"],
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
  assert.deepEqual(
    database
      .prepare("SELECT receipt FROM pantry_attempts WHERE request_id = ?")
      .get(ids[0]),
    { receipt: '[{"id":3,"transaction_id":"x1"}]' },
  );
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
  await createBackupJob({ database, directory: copies, keep: 1, clock }).run({
    signal: new AbortController().signal,
  });
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
    [
      reason(pending),
      reason(sending),
      restored.database.prepare(markers).all(),
    ],
    ["restored_backup", "restored_backup", []],
  );
  requests.recoverRequests(database, clock);
  assert.deepEqual(
    [
      request(pending)?.state,
      request(sending)?.state,
      request(sending)?.reason,
    ],
    ["pending", "uncertain", "restarted"],
  );
  const attempts = "SELECT outcome, reason FROM pantry_attempts";
  assert.deepEqual(
    [
      restored.database.prepare(attempts).all(),
      database.prepare(attempts).all(),
    ],
    [
      [{ outcome: "uncertain", reason: "restored_backup" }],
      [{ outcome: "uncertain", reason: "restarted" }],
    ],
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
  database
    .prepare(
      "UPDATE pantry_requests SET user_id = ?, intake_id = NULL WHERE id = ?",
    )
    .run(member.id, uncertain);
  assert.deepEqual(service.read(owner.id).requested, [
    { product_id: 7, stock_unit_id: 2, pending: 1, sending: 0, uncertain: 0 },
  ]);
  assert.throws(
    () => service.reset(owner.id, true),
    /pantry_requests_unresolved/,
  );
  assert.deepEqual(
    [
      service.read(owner.id).state,
      request(pending)?.state,
      database.prepare("SELECT product_id FROM pantry_bindings").all(),
    ],
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
  const failed = (name: string) => () => events.push(`${name} failed`);
  const result = writeTransaction(database, (scope) => {
    afterCommit(scope, () => JSON.parse("{"), failed("sync"));
    afterCommit(scope, () => Promise.reject(new Error()), failed("async"));
    afterCommit(
      scope,
      () => events.push(database.inTransaction ? "too early" : "later"),
      assert.fail,
    );
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
