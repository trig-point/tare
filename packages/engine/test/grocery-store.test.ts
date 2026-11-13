import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { createBackupJob } from "../src/backup.ts";
import { openDatabase, writeTransaction } from "../src/db.ts";
import * as store from "../src/grocery/store.ts";
import { numbersFrom } from "../src/logging/schemas.ts";
import { recoverRequests } from "../src/pantry/requests.ts";
import { createPantryService } from "../src/pantry/service.ts";
import { test } from "./support/hang-ceiling.ts";

const config = {
  url: "http://grocy/api",
  apiKey: "invented-secret",
  username: "example-owner",
};
const clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };
const rice = {
  ...numbersFrom({ kcal: 160, carbs_g: 36 }),
  name: "Example jasmine rice",
  serving_size: 45,
  serving_unit: "g",
  provenance: "label" as const,
  source: "Example package label",
  source_food_id: null,
};
const mutation = (digit: number) =>
  `00000000-0000-4000-8000-00000000000${digit}`;

function setup(context: TestContext, path?: string) {
  const directory = mkdtempSync(join(tmpdir(), "tare-grocery-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const connection = openDatabase(path ?? join(directory, "tare.sqlite"));
  context.after(connection.close);
  const { database } = connection;
  const person = (username: string) =>
    Number(
      database
        .prepare(
          "INSERT INTO users (username, timezone, is_admin, created_at) VALUES (?, 'UTC', 0, ?)",
        )
        .run(username, clock.now().toISOString()).lastInsertRowid,
    );
  const owner = path ? 1 : person("example-owner");
  const member = path ? 2 : person("example-member");
  const service = createPantryService({
    database,
    config,
    ownerId: owner,
    clock,
  });
  const create = (
    digit: number,
    userId = owner,
    plan = "{}",
    steps: store.StepKind[] = ["product", "stock_add"],
  ) =>
    writeTransaction(database, (scope) =>
      store.insertGroceryRequest(
        scope,
        {
          ownerId: owner,
          userId,
          mutationId: mutation(digit),
          plan,
          restoreNonce: store.currentNonce(database),
          steps,
          food: { values: rice },
        },
        clock,
      ),
    );
  const claim = (requestId: number, number: number, add = false) =>
    store.claimGroceryStep(
      database,
      { request_id: requestId, number },
      clock,
      add ? { product_id: 9, stock_log_max: 41 } : undefined,
    );
  const purchase = (requestId: number, transactionId: string) => {
    const product = claim(requestId, 1);
    assert.ok(product);
    store.finalizeGroceryStep(
      database,
      product,
      { status: "confirmed", value: 9 },
      clock,
    );
    const add = claim(requestId, 2, true);
    assert.ok(add);
    return store.finalizeGroceryStep(
      database,
      add,
      { status: "confirmed", value: { transactionId, rows: [] } },
      clock,
    );
  };
  const counts = database.prepare<[], Record<string, number>>(
    "SELECT (SELECT count(*) FROM foods) AS foods, (SELECT count(*) FROM grocery_requests) AS grocery_requests, (SELECT count(*) FROM grocery_transactions) AS grocery_transactions",
  );
  const count = (
    table: "foods" | "grocery_requests" | "grocery_transactions",
  ) => counts.get()?.[table];
  return {
    database,
    directory,
    owner,
    member,
    service,
    create,
    claim,
    purchase,
    count,
  };
}

test("a grocery request stores its plan and new food once, per owner", (context) => {
  const { database, owner, member, create, count } = setup(context);
  const first = create(1);
  assert.deepEqual(
    [first.created, first.steps.map((step) => [step.number, step.kind])],
    [
      true,
      [
        [1, "product"],
        [2, "stock_add"],
      ],
    ],
  );
  assert.equal(create(1).created, false);
  assert.throws(() => create(1, owner, "[]"), { code: "grocery_conflict" });
  assert.throws(() => create(2, member), { code: "forbidden" });
  assert.throws(() => create(3, owner, "{}", ["stock_add", "product"]), {
    code: "invalid_request",
  });
  assert.deepEqual([count("grocery_requests"), count("foods")], [1, 1]);
  assert.throws(
    () => database.prepare("UPDATE grocery_requests SET plan = '[1]'").run(),
    /immutable/,
  );
});

test("steps claim in order, once, and settle only under their own token", (context) => {
  const { database, create, claim } = setup(context);
  const { request } = create(1);
  assert.equal(claim(request.id, 2, true), null);
  const product = claim(request.id, 1);
  assert.ok(product);
  assert.equal(claim(request.id, 1), null);
  const stale = { ...product, claim_token: "stale" };
  assert.equal(
    store.finalizeGroceryStep(database, stale, undefined, clock),
    false,
  );
  store.finalizeGroceryStep(
    database,
    product,
    { status: "not_sent", reason: "transport" },
    clock,
  );
  const retried = claim(request.id, 1);
  assert.ok(retried);
  // A read result is not a write receipt.
  store.finalizeGroceryStep(
    database,
    retried,
    { status: "ok", value: 41 },
    clock,
  );
  assert.deepEqual(
    store
      .readGrocery(database, request.user_id, request.mutation_id)
      ?.steps.map((step) => [step.state, step.reason]),
    [
      ["uncertain", "response_withheld"],
      ["pending", null],
    ],
  );
  assert.equal(claim(request.id, 2, true), null);
  const later = create(2).request;
  database
    .prepare("UPDATE pantry_connection SET url = 'http://other/api'")
    .run();
  assert.equal(claim(later.id, 1), null);
});

test("a purchase transaction credits one request and binding is compare-and-set", (context) => {
  const { database, owner, create, purchase } = setup(context);
  const { request } = create(1);
  assert.equal(purchase(request.id, "tx1"), true);
  const other = create(2).request;
  purchase(other.id, "tx1");
  assert.deepEqual(
    store
      .readGrocery(database, owner, other.mutation_id)
      ?.steps.map((step) => step.state),
    ["confirmed", "uncertain"],
  );
  assert.deepEqual(
    [
      store.readGrocery(database, owner, request.mutation_id)?.request.state,
      store.readGrocery(database, owner, other.mutation_id)?.steps[1]?.reason,
    ],
    ["binding_pending", "transaction_reserved"],
  );
  const added = store.readGrocery(database, owner, request.mutation_id)
    ?.steps[1];
  assert.deepEqual([added?.product_id, added?.stock_log_max], [9, 41]);
  database
    .prepare(
      "INSERT INTO pantry_bindings VALUES (?, 1, 'food', ?, 3, 2, 1, 'valid', 'concurrent')",
    )
    .run(owner, request.food_id);
  const bind = (
    digit: number,
    expected: { change_token: string; status: string } | null,
  ) =>
    store.bindGrocery(
      database,
      {
        ownerId: owner,
        userId: owner,
        mutationId: mutation(digit),
        requestId: request.id,
        restoreNonce: store.currentNonce(database),
        expected,
        binding: { product_id: 9, stock_unit_id: 2, quantity_per_serving: 1 },
      },
      clock,
    );
  assert.throws(() => bind(5, null), { code: "grocery_binding_changed" });
  const current = store.groceryBinding(database, request);
  assert.ok(current);
  assert.throws(() => bind(7, { ...current, change_token: "stale" }), {
    code: "grocery_binding_changed",
  });
  assert.deepEqual(bind(6, current), { state: "completed", replayed: false });
  const reordered = {
    status: current.status,
    change_token: current.change_token,
  };
  assert.deepEqual(bind(6, reordered), { state: "completed", replayed: true });
  assert.throws(() => bind(6, null), { code: "decision_conflict" });
  assert.equal(store.groceryBinding(database, request)?.product_id, 9);
});

test("restart and restore make unfinished steps uncertain and rotate the nonce", async (context) => {
  const { database, directory, owner, create, claim } = setup(context);
  const { request } = create(1);
  assert.ok(claim(request.id, 1));
  const before = store.currentNonce(database);
  await createBackupJob({
    database,
    directory: join(directory, "copies"),
    keep: 1,
    clock,
  }).run({ signal: new AbortController().signal });
  recoverRequests(database, clock);
  assert.deepEqual(
    [
      store.readGrocery(database, owner, request.mutation_id)?.steps[0]?.reason,
      store.currentNonce(database),
    ],
    ["restarted", before],
  );

  const copy = join(
    directory,
    "copies",
    readdirSync(join(directory, "copies"))[0] ?? "",
  );
  const restored = setup(context, copy);
  recoverRequests(restored.database, clock);
  const nonce = store.currentNonce(restored.database);
  assert.notEqual(nonce, before);
  assert.deepEqual(
    store
      .readGrocery(restored.database, owner, request.mutation_id)
      ?.steps.map((step) => [step.state, step.reason]),
    [
      ["uncertain", "restored_backup"],
      ["uncertain", "restored_backup"],
    ],
  );
  const adopt = (
    digit: number,
    number: number,
    proof: Parameters<typeof store.adoptGroceryStep>[1]["proof"],
    restoreNonce = nonce,
  ) =>
    store.adoptGroceryStep(
      restored.database,
      {
        ownerId: owner,
        userId: owner,
        mutationId: mutation(digit),
        requestId: request.id,
        number,
        restoreNonce,
        proof,
      },
      clock,
    );
  assert.throws(() => adopt(2, 1, { object_id: 9 }, before), {
    code: "grocery_connection_changed",
  });
  const mixed = { object_id: 9, transaction_id: "tx8", product_id: 9 };
  assert.throws(() => adopt(8, 1, mixed), { code: "grocery_proof_ambiguous" });
  assert.equal(adopt(3, 1, { object_id: 9 }).state, "open");
  assert.throws(() => adopt(5, 2, { object_id: 9 }), {
    code: "grocery_step_not_adoptable",
  });
  // The add was never claimed before the backup, so only the proof names its product.
  const purchase = { transaction_id: "tx9", product_id: 9 };
  assert.equal(adopt(6, 2, purchase).state, "binding_pending");
  const bound = store.bindGrocery(
    restored.database,
    {
      ownerId: owner,
      userId: owner,
      mutationId: mutation(7),
      requestId: request.id,
      restoreNonce: nonce,
      expected: null,
      binding: { product_id: 9, stock_unit_id: 2, quantity_per_serving: 1 },
    },
    clock,
  );
  assert.equal(bound.state, "completed");
  assert.throws(
    () =>
      writeTransaction(restored.database, (scope) =>
        store.insertGroceryRequest(
          scope,
          {
            ownerId: owner,
            userId: owner,
            mutationId: mutation(4),
            plan: "{}",
            restoreNonce: before,
            steps: ["stock_add"],
            food: { food_id: request.food_id },
          },
          clock,
        ),
      ),
    { code: "grocery_restored" },
  );
});

test("unfinished groceries block reset until the owner abandons them; reservations outlive it", (context) => {
  const { database, owner, member, service, create, claim, purchase, count } =
    setup(context);
  const { request } = create(1);
  purchase(request.id, "tx1");
  const sending = claim(create(2).request.id, 1);
  assert.ok(sending);
  database.prepare("UPDATE pantry_connection SET reset_required = 1").run();
  assert.throws(() => service.reset(owner), {
    code: "pantry_requests_unresolved",
  });
  assert.deepEqual(
    store.openGroceries(database).map((row) => [row.mutation_id, row.state]),
    [
      [request.mutation_id, "binding_pending"],
      [mutation(2), "open"],
    ],
  );
  const abandon = (userId: number, digit: number, requestId = request.id) =>
    store.abandonGrocery(
      database,
      { ownerId: owner, userId, mutationId: mutation(digit), requestId },
      clock,
    );
  assert.throws(() => abandon(owner, 4, sending.request_id), {
    code: "grocery_not_abandonable",
  });
  store.finalizeGroceryStep(
    database,
    sending,
    { status: "not_sent", reason: "transport" },
    clock,
  );
  assert.equal(abandon(owner, 5, sending.request_id).state, "abandoned");
  assert.throws(() => abandon(member, 2), { code: "forbidden" });
  assert.equal(abandon(owner, 3).state, "abandoned");
  assert.equal(service.reset(owner).generation, 2);
  assert.deepEqual(
    [count("grocery_requests"), count("grocery_transactions")],
    [2, 1],
  );
});
