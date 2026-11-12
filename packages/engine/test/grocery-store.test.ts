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
          planHash: plan.padEnd(64, "0"),
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
  const count = (table: string) =>
    (
      database.prepare(`SELECT count(*) AS rows FROM ${table}`).get() as {
        rows: number;
      }
    ).rows;
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
  assert.equal(store.readGrocery(database, member, mutation(1)), null);
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
  store.finalizeGroceryStep(database, retried, undefined, clock);
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
  assert.deepEqual(bind(6, current), { state: "completed", replayed: false });
  assert.deepEqual(bind(6, current), { state: "completed", replayed: true });
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
  const adopt = (digit: number, restoreNonce: string) =>
    store.adoptGroceryStep(
      restored.database,
      {
        ownerId: owner,
        userId: owner,
        mutationId: mutation(digit),
        requestId: request.id,
        number: 1,
        restoreNonce,
        proof: { object_id: 9 },
      },
      clock,
    );
  assert.throws(() => adopt(2, before), { code: "grocery_connection_changed" });
  assert.equal(adopt(3, nonce).state, "open");
  assert.throws(
    () =>
      writeTransaction(restored.database, (scope) =>
        store.insertGroceryRequest(
          scope,
          {
            ownerId: owner,
            userId: owner,
            mutationId: mutation(4),
            planHash: "0".repeat(64),
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

test("open groceries block reset until the owner abandons them", (context) => {
  const { database, owner, member, service, create, count } = setup(context);
  const { request } = create(1);
  database.prepare("UPDATE pantry_connection SET reset_required = 1").run();
  assert.throws(() => service.reset(owner), {
    code: "pantry_requests_unresolved",
  });
  assert.deepEqual(
    store.openGroceries(database).map((row) => row.mutation_id),
    [request.mutation_id],
  );
  const abandon = (userId: number, digit: number) =>
    store.abandonGrocery(
      database,
      {
        ownerId: owner,
        userId,
        mutationId: mutation(digit),
        requestId: request.id,
      },
      clock,
    );
  assert.throws(() => abandon(member, 2), { code: "forbidden" });
  assert.equal(abandon(owner, 3).state, "abandoned");
  assert.equal(service.reset(owner).generation, 2);
  assert.equal(count("grocery_requests"), 1);
});
