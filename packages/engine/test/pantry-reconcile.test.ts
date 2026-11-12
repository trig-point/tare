import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { openDatabase, writeTransaction } from "../src/db.ts";
import { insertIntake } from "../src/logging/intake.ts";
import { OperationError } from "../src/operations/registry.ts";
import { createPantryDispatcher } from "../src/pantry/dispatch.ts";
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

function setup(context: TestContext, holds = () => false) {
  const connection = openDatabase(":memory:");
  context.after(connection.close);
  const { database } = connection;
  let now = new Date(start);
  const clock = { now: () => now };
  const person = (username: string) =>
    Number(
      database
        .prepare(
          "INSERT INTO users (username, timezone, is_admin, created_at) VALUES (?, 'UTC', 0, ?)",
        )
        .run(username, start).lastInsertRowid,
    );
  const owner = person("example-owner");
  const member = person("example-member");
  const food = Number(
    database
      .prepare(
        "INSERT INTO foods (user_id, name, provenance) VALUES (?, 'Synthetic soup', 'label')",
      )
      .run(owner).lastInsertRowid,
  );
  createPantryService({ database, config, ownerId: owner, clock });
  database
    .prepare(
      "INSERT INTO pantry_bindings VALUES (?, 1, 'food', ?, 7, 2, 0.5, 'valid', 'token')",
    )
    .run(owner, food);
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
  const ownerPerson = {
    id: owner,
    username: "example-owner",
    is_admin: 0,
    timezone: "UTC",
    day_start_hour: 0,
  };
  const identity = {
    user_id: owner,
    generation: 1,
    url: config.url,
    username: config.username,
  };
  const key = (id: string) => ({ id, product_id: 7, stock_unit_id: 2 });
  const view = (id: string) => {
    const listed = reconciliation.list();
    return [...listed.unresolved, ...listed.history].find(
      (request) => request.request_id === id,
    );
  };
  return {
    database,
    clock,
    owner,
    member,
    effects,
    state,
    identity,
    key,
    view,
    list: () => reconciliation.list(),
    step(milliseconds: number) {
      now = new Date(now.getTime() + milliseconds);
    },
    log: (client_id: string) =>
      writeTransaction(database, (scope) =>
        insertIntake(
          scope,
          ownerPerson,
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
    decide(
      request_id: string,
      attempt_number: number,
      decision: "delivered" | "not_delivered_retry" | "abandoned",
      mutation_id = `${request_id}-${attempt_number}-${decision}`,
    ) {
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
    },
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
    [view(legacy)?.current_number, view(legacy)?.attempts[0]?.uncertain_since],
    [1, start],
  );
  const restored = view(id);
  assert.deepEqual(
    [
      restored?.state,
      restored?.current_number,
      restored?.attempts.map(({ number, kind, uncertain_since }) => [
        number,
        kind,
        uncertain_since,
      ]),
      restored?.retry,
    ],
    [
      "uncertain",
      1,
      [[1, "recovery", start]],
      {
        eligible: false,
        not_before: "2026-01-01T00:15:00.000Z",
        reason: "too_early",
      },
    ],
  );
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
  const { database, clock, identity, key, view, list, step, log, decide } =
    setup(context);
  const id = log("rejected");
  const reject = () =>
    requests.rejectRequest(database, key(id), identity, "unit_mismatch", clock);
  assert.deepEqual([reject(), reject()], [true, false]);
  assert.equal(typeof decide(id, 1, "not_delivered_retry"), "object");
  assert.equal(typeof decide(id, 1, "abandoned"), "object");
  assert.equal(
    decide(id, 1, "abandoned", "another"),
    "pantry_request_not_actionable",
  );
  const resolved = view(id);
  assert.deepEqual(
    [
      resolved?.state,
      resolved?.resolved_at,
      resolved?.attempts.map(({ number, kind, reason }) => [
        number,
        kind,
        reason,
      ]),
      resolved?.decisions.map(({ number, kind, decision }) => [
        number,
        kind,
        decision,
      ]),
    ],
    [
      "abandoned",
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

test("reset-required refuses retry but not abandon or delivered, and only the active connection's delivery refreshes", (context) => {
  const {
    database,
    member,
    effects,
    identity,
    key,
    view,
    log,
    decide,
    ...rest
  } = setup(context);
  const [current, predecessor, rejected] = ["a", "b", "c"].map(log);
  for (const id of [current, predecessor]) rest.uncertain(id as string);
  requests.rejectRequest(
    database,
    key(rejected as string),
    identity,
    "unit_mismatch",
    rest.clock,
  );
  database
    .prepare(
      "UPDATE pantry_requests SET user_id = ?, intake_id = NULL WHERE id = ?",
    )
    .run(member, predecessor);
  assert.equal(view(predecessor as string)?.predecessor_owner, true);
  assert.equal(typeof decide(current as string, 1, "delivered"), "object");
  assert.equal(typeof decide(predecessor as string, 1, "delivered"), "object");
  assert.deepEqual(effects, ["refresh"]);
  database.exec("UPDATE pantry_connection SET reset_required = 1");
  assert.equal(
    decide(rejected as string, 1, "not_delivered_retry"),
    "pantry_reset_required",
  );
  assert.equal(typeof decide(rejected as string, 1, "abandoned"), "object");
  assert.deepEqual(rest.list().state, "reset_required");
});

test("a sender's live claim blocks retry, and stopping refuses new decisions but replays recorded ones", async (context) => {
  const blocked = setup(context, () => true);
  const held = blocked.log("held");
  blocked.uncertain(held);
  blocked.step(15 * minute);
  assert.equal(
    blocked.decide(held, 1, "not_delivered_retry"),
    "pantry_request_in_flight",
  );
  const receipt = blocked.decide(held, 1, "abandoned");
  blocked.state.stopping = true;
  assert.deepEqual(
    [
      blocked.decide(held, 1, "abandoned"),
      blocked.decide(held, 1, "delivered"),
    ],
    [receipt, "pantry_stopping"],
  );

  const { database, clock, owner, log } = setup(context);
  const id = log("sending");
  const entered = Promise.withResolvers<void>();
  const answer = Promise.withResolvers<undefined>();
  const dispatcher = createPantryDispatcher({
    database,
    config,
    ownerId: owner,
    clock,
    client: {
      catalog: async () => ({ status: "ok", value: [{ id: 7, active: 1 }] }),
      product: async () => ({
        status: "ok",
        value: {
          product: { id: 7, qu_id_stock: 2, enable_tare_weight_handling: 0 },
          quantity_unit_stock: { id: 2 },
        },
      }),
      consume: () => {
        entered.resolve();
        return answer.promise;
      },
    } as never,
    refresh: async () => undefined,
    report: () => {},
  });
  dispatcher.kick();
  await entered.promise;
  const during = dispatcher.holds(id, 1);
  answer.resolve(undefined);
  await dispatcher.stop();
  assert.deepEqual([during, dispatcher.holds(id, 1)], [true, false]);
});
