import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { openDatabase, writeTransaction } from "../src/db.ts";
import { insertIntake } from "../src/logging/intake.ts";
import { OperationError } from "../src/operations/registry.ts";
import { createReconciliation } from "../src/pantry/reconcile.ts";
import * as requests from "../src/pantry/requests.ts";
import { createPantryService } from "../src/pantry/service.ts";
import { test } from "./support/hang-ceiling.ts";

const config = {
  url: "http://grocy/api",
  apiKey: "invented-secret",
  username: "example-owner",
};
const minute = 60_000;
const start = "2026-01-01T00:00:00.000Z";
type Decision = "delivered" | "not_delivered_retry" | "abandoned";
const pick = <Row>(rows: Row[] | undefined, ...keys: (keyof Row)[]) =>
  rows?.map((row) => keys.map((name) => row[name]));

function setup(context: TestContext, holds = () => false) {
  const connection = openDatabase(":memory:");
  context.after(connection.close);
  const { database } = connection;
  const insert = (sql: string, ...values: unknown[]) =>
    Number(database.prepare(sql).run(...values).lastInsertRowid);
  let now = new Date(start);
  const clock = { now: () => now };
  const addUser = (username: string) =>
    insert(
      "INSERT INTO users (username, timezone, is_admin, created_at) VALUES (?, 'UTC', 0, ?)",
      username,
      start,
    );
  const owner = addUser("example-owner");
  const member = addUser("example-member");
  const food = insert(
    "INSERT INTO foods (user_id, name, provenance) VALUES (?, 'Synthetic soup', 'label')",
    owner,
  );
  createPantryService({ database, config, ownerId: owner, clock });
  insert(
    "INSERT INTO pantry_bindings VALUES (?, 1, 'food', ?, 7, 2, 0.5, 'valid', 'token')",
    owner,
    food,
  );
  const stock = requests.createPantryStock({
    config,
    ownerId: owner,
    clock,
    report: assert.fail,
  });
  const effects: string[] = [];
  const state = { stopping: false };
  const reconciliation = createReconciliation({
    database,
    ownerId: owner,
    clock,
    stopping: () => state.stopping,
    dispatch: { kick: () => effects.push("kick"), holds },
    refresh: () => effects.push("refresh"),
    report: (code) => effects.push(code),
  });
  const identity = { user_id: owner, generation: 1, ...config };
  const key = (id: string) => ({ id, product_id: 7, stock_unit_id: 2 });
  const list = () => reconciliation.list();
  const decide = (
    request_id: string,
    attempt_number: number,
    decision: Decision,
    mutation_id = `${request_id}-${attempt_number}-${decision}`,
  ) => {
    try {
      return reconciliation.decide(owner, {
        request_id,
        attempt_number,
        mutation_id,
        decision,
      });
    } catch (caught) {
      if (caught instanceof OperationError) return caught.code;
      throw caught;
    }
  };
  return {
    database,
    clock,
    member,
    effects,
    state,
    identity,
    key,
    list,
    decide,
    view: (id: string) =>
      [...list().unresolved, ...list().history].find(
        (request) => request.request_id === id,
      ),
    step(milliseconds: number) {
      now = new Date(now.getTime() + milliseconds);
    },
    log: (client_id: string) =>
      writeTransaction(database, (scope) =>
        insertIntake(
          scope,
          {
            id: owner,
            username: "example-owner",
            is_admin: 0,
            timezone: "UTC",
            day_start_hour: 0,
          },
          {
            client_id,
            reference: { kind: "food", id: food },
            servings: 2,
            claim: {},
          },
          clock,
          stock,
        ),
      ).stock?.request_id ?? "",
    uncertain(id: string) {
      const claim = requests.claimRequest(database, key(id), identity, clock);
      assert.ok(claim);
      requests.finalizeClaim(database, claim, undefined, clock);
    },
    reject: (id: string) =>
      requests.rejectRequest(
        database,
        key(id),
        identity,
        "unit_mismatch",
        clock,
      ),
    /** Each row is [request, number, decision, expected resulting state or error code]. */
    outcomes: (rows: [string, number, Decision, string][]) =>
      rows.map(([id, number, decision]) => {
        const result = decide(id, number, decision);
        return typeof result === "string" ? result : result.resulting_state;
      }),
  };
}

test("a restored request gets a numbered recovery record, waits 15 minutes and retries its frozen quantity", (context) => {
  const { database, clock, effects, identity, key, view, step, log, decide } =
    setup(context);
  const id = log("restored");
  // Restored before this schema: uncertain with no attempt and no uncertainty time.
  const legacy = log("legacy");
  database
    .prepare("UPDATE pantry_requests SET state = 'uncertain' WHERE id = ?")
    .run(legacy);
  database.exec("INSERT INTO pantry_backup_marker VALUES (1)");
  requests.recoverRequests(database, clock);
  step(minute);
  requests.recoverRequests(database, clock);
  assert.deepEqual(
    [id, legacy].map((request) => [
      view(request)?.state,
      pick(view(request)?.attempts, "number", "kind", "uncertain_since"),
    ]),
    Array(2).fill(["uncertain", [[1, "recovery", start]]]),
  );
  assert.deepEqual(view(id)?.retry, {
    eligible: false,
    not_before: "2026-01-01T00:15:00.000Z",
    reason: "too_early",
  });
  assert.equal(decide(id, 0, "abandoned"), "pantry_stale_attempt");
  step(14 * minute - 1);
  assert.equal(decide(id, 1, "not_delivered_retry"), "pantry_retry_too_early");
  step(1);
  const receipt = decide(id, 1, "not_delivered_retry");
  assert.deepEqual(
    [
      typeof receipt === "object" && receipt.resulting_state,
      decide(id, 1, "not_delivered_retry"),
      decide(id, 1, "abandoned", `${id}-1-not_delivered_retry`),
      effects,
    ],
    ["pending", receipt, "mutation_conflict", ["kick"]],
  );
  database
    .prepare(
      "UPDATE intake_entries SET servings = 4 WHERE id = (SELECT intake_id FROM pantry_requests WHERE id = ?)",
    )
    .run(id);
  const claim = requests.claimRequest(database, key(id), identity, clock);
  assert.deepEqual(
    [claim?.quantity, claim?.attempt_count, view(id)?.edit_notice],
    [1, 2, { servings: 4 }],
  );
});

test("a local rejection takes one number, retries at once, and a pending abandon after it keeps every record for 30 days", (context) => {
  const { view, list, step, log, reject, outcomes } = setup(context);
  const id = log("rejected");
  assert.deepEqual([reject(id), reject(id)], [true, false]);
  const rows: [string, number, Decision, string][] = [
    [id, 1, "not_delivered_retry", "pending"],
    [id, 1, "abandoned", "abandoned"],
  ];
  assert.deepEqual(
    outcomes(rows),
    rows.map((row) => row[3]),
  );
  const resolved = view(id);
  assert.deepEqual(
    [
      resolved?.resolved_at,
      pick(resolved?.attempts, "number", "kind", "reason"),
      pick(resolved?.decisions, "number", "kind", "decision"),
    ],
    [
      start,
      [[1, "local_rejection", "unit_mismatch"]],
      [
        [1, "attempt_resolution", "not_delivered_retry"],
        [1, "pending_abandon", "abandoned"],
      ],
    ],
  );
  step(30 * 24 * 60 * minute);
  assert.equal(list().history.length, 1);
  step(1);
  assert.deepEqual(list(), { state: "ready", unresolved: [], history: [] });
});

test("decisions follow state, reset and predecessor rules, and only the active connection's delivery refreshes", (context) => {
  const { database, member, effects, log, ...rest } = setup(context);
  const [current, predecessor, rejected, pending] = ["a", "b", "c", "d"].map(
    log,
  ) as [string, string, string, string];
  rest.uncertain(current);
  rest.uncertain(predecessor);
  rest.reject(rejected);
  database
    .prepare(
      "UPDATE pantry_requests SET user_id = ?, intake_id = NULL WHERE id = ?",
    )
    .run(member, predecessor);
  const beforeReset: [string, number, Decision, string][] = [
    [pending, 0, "delivered", "pantry_request_not_actionable"],
    [current, 1, "delivered", "delivered"],
    [predecessor, 1, "delivered", "delivered"],
    [predecessor, 1, "abandoned", "pantry_request_not_actionable"],
  ];
  const afterReset: [string, number, Decision, string][] = [
    [rejected, 1, "not_delivered_retry", "pantry_reset_required"],
    [rejected, 1, "abandoned", "abandoned"],
    [pending, 0, "abandoned", "abandoned"],
  ];
  const before = rest.outcomes(beforeReset);
  database.exec("UPDATE pantry_connection SET reset_required = 1");
  assert.deepEqual(
    [before, rest.outcomes(afterReset), effects, rest.list().state],
    [
      beforeReset.map((row) => row[3]),
      afterReset.map((row) => row[3]),
      ["refresh"],
      "reset_required",
    ],
  );
});

test("a sender's live claim blocks retry, and stopping refuses new decisions but replays recorded ones", (context) => {
  const { state, step, log, uncertain, decide } = setup(context, () => true);
  const held = log("held");
  uncertain(held);
  step(15 * minute);
  assert.equal(
    decide(held, 1, "not_delivered_retry"),
    "pantry_request_in_flight",
  );
  const receipt = decide(held, 1, "abandoned");
  state.stopping = true;
  assert.deepEqual(
    [decide(held, 1, "abandoned"), decide(held, 1, "delivered")],
    [receipt, "pantry_stopping"],
  );
});
