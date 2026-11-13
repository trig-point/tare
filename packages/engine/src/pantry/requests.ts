import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { z } from "zod";
import {
  afterCommit,
  scopeDatabase,
  type WriteScope,
  writeTransaction,
} from "../db.ts";
import { recoverGroceries } from "../grocery/store.ts";
import type { GrocyResult, grocyBookingsSchema } from "../grocy/client.ts";
import type { GrocyConfig } from "../grocy/config.ts";
import { OperationError } from "../operations/registry.ts";
import { claimRequest as claimQuery } from "../queries/pantry/claim-request.ts";
import { clearBackupMarker } from "../queries/pantry/clear-backup-marker.ts";
import { finalizeAttempt } from "../queries/pantry/finalize-attempt.ts";
import { finalizeRequest } from "../queries/pantry/finalize-request.ts";
import { insertAttempt } from "../queries/pantry/insert-attempt.ts";
import { insertLocalRejection } from "../queries/pantry/insert-local-rejection.ts";
import { insertOutcome } from "../queries/pantry/insert-outcome.ts";
import { insertRequest } from "../queries/pantry/insert-request.ts";
import { readBinding } from "../queries/pantry/read-binding.ts";
import { readConnection } from "../queries/pantry/read-connection.ts";
import { readOutcome } from "../queries/pantry/read-outcome.ts";
import { readRequest } from "../queries/pantry/read-request.ts";
import { readRequestByClient } from "../queries/pantry/read-request-by-client.ts";
import { recoverAttempts } from "../queries/pantry/recover-attempts.ts";
import { recoverRecords } from "../queries/pantry/recover-records.ts";
import { recoverRequests as recoverQuery } from "../queries/pantry/recover-requests.ts";
import { rejectRequest as rejectQuery } from "../queries/pantry/reject-request.ts";

export type StockReason =
  | "disabled"
  | "not_owner"
  | "reset_required"
  | "no_binding"
  | "product_missing"
  | "unit_mismatch"
  | "tare_enabled";
export type RequestState =
  | "pending"
  | "sending"
  | "uncertain"
  | "rejected"
  | "delivered"
  | "cancelled"
  | "abandoned";
export type StockOutcome = {
  generation: number | null;
  request_id: string | null;
  reason: StockReason | null;
  state: RequestState | null;
};
type IntakeRow = {
  id: number;
  client_id: string;
  food_id: number | null;
  source_food_id: number | null;
  servings: number | null;
};
export interface PantryStock {
  record(
    scope: WriteScope,
    personId: number,
    entry: IntakeRow,
    created: boolean,
  ): StockOutcome | null;
}
/** The connection a dispatcher validated; claims and rejections apply only while it is still current. */
export type PantryConnection = {
  user_id: number;
  generation: number;
  url: string;
  username: string;
};
type RequestKey = { id: string; product_id: number; stock_unit_id: number };
export type Claim = {
  id: string;
  user_id: number;
  generation: number;
  product_id: number;
  stock_unit_id: number;
  quantity: number;
  attempt_count: number;
  claim_token: string;
};
type ConsumeResult =
  | GrocyResult<z.output<typeof grocyBookingsSchema>>
  | undefined;

export function createPantryStock({
  config,
  ownerId,
  clock,
  kick,
  report,
}: {
  config: GrocyConfig | null;
  ownerId: number | null;
  clock: { now(): Date };
  kick?: () => unknown;
  report: () => void;
}): PantryStock {
  function decide(database: Database, personId: number, entry: IntakeRow) {
    if (!config) return { generation: null, reason: "disabled" as const };
    const row = readConnection(database);
    if (!row) throw new Error("Pantry connection missing");
    const { generation } = row;
    if (personId !== ownerId)
      return { generation, reason: "not_owner" as const };
    if (
      row.reset_required ||
      row.url !== config.url ||
      row.username !== config.username ||
      row.user_id !== ownerId
    )
      return { generation, reason: "reset_required" as const };
    const [binding] = readBinding(database, {
      user_id: personId,
      generation,
      reference_kind: entry.food_id !== null ? "food" : "source_food",
      reference_id: (entry.food_id ?? entry.source_food_id) as number,
    });
    if (!binding) return { generation, reason: "no_binding" as const };
    if (binding.status !== "valid")
      return { generation, reason: binding.status as StockReason };
    return { generation, reason: null, binding };
  }
  return {
    record(scope, personId, entry, created) {
      const database = scopeDatabase(scope);
      if (entry.food_id === null && entry.source_food_id === null) return null;
      if (created) {
        // A lifetime client match means this log replays a deleted intake: name that request, never consume again.
        const [retained] = readRequestByClient(database, {
          user_id: personId,
          client_id: entry.client_id,
        });
        const decided = retained
          ? { generation: retained.generation, reason: null }
          : decide(database, personId, entry);
        let requestId = retained?.id ?? null;
        if ("binding" in decided && decided.binding) {
          const { binding, generation } = decided;
          const quantity = (entry.servings ?? 0) * binding.quantity_per_serving;
          if (!Number.isFinite(quantity) || quantity <= 0)
            throw new OperationError(400, "invalid_request");
          requestId = randomUUID();
          insertRequest(database, {
            id: requestId,
            user_id: personId,
            generation,
            client_id: entry.client_id,
            intake_id: entry.id,
            reference_kind: entry.food_id !== null ? "food" : "source_food",
            reference_id: (entry.food_id ?? entry.source_food_id) as number,
            product_id: binding.product_id,
            stock_unit_id: binding.stock_unit_id,
            quantity_per_serving: binding.quantity_per_serving,
            quantity,
            created_at: clock.now().toISOString(),
          });
          if (kick) afterCommit(scope, kick, report);
        }
        insertOutcome(database, {
          intake_id: entry.id,
          user_id: personId,
          generation: decided.generation,
          request_id: requestId,
          reason: decided.reason,
        });
      }
      const outcome = readOutcome(database, {
        user_id: personId,
        intake_id: entry.id,
      });
      if (!outcome) return null;
      const request =
        outcome.request_id === null
          ? undefined
          : readRequest(database, { id: outcome.request_id })[0];
      return {
        generation: outcome.generation,
        request_id: outcome.request_id,
        reason: outcome.reason as StockReason | null,
        state: (request?.state ?? null) as RequestState | null,
      };
    },
  };
}

function connectionCurrent(database: Database, expected: PantryConnection) {
  const row = readConnection(database);
  return (
    !!row &&
    !row.reset_required &&
    row.generation === expected.generation &&
    row.user_id === expected.user_id &&
    row.url === expected.url &&
    row.username === expected.username
  );
}

/** Commits pending to sending with a new token and attempt; the returned payload is what may be sent. */
export function claimRequest(
  database: Database,
  request: RequestKey,
  connection: PantryConnection,
  clock: { now(): Date },
): Claim | null {
  return writeTransaction(database, (scope) => {
    const database = scopeDatabase(scope);
    if (!connectionCurrent(database, connection)) return null;
    const token = randomUUID();
    const [claimed] = claimQuery(
      database,
      { claim_token: token, now: clock.now().toISOString() },
      {
        ...request,
        user_id: connection.user_id,
        generation: connection.generation,
      },
    );
    if (!claimed) return null;
    if (!Number.isFinite(claimed.quantity) || claimed.quantity <= 0)
      throw new Error("Invalid frozen quantity");
    insertAttempt(database, {
      request_id: claimed.id,
      number: claimed.attempt_count,
      token,
      started_at: clock.now().toISOString(),
    });
    return { ...claimed, claim_token: token };
  });
}

/** Rejects a still-pending request after a pre-send read proved it ineligible, under a new local record number; returns false if the state changed first. */
export function rejectRequest(
  database: Database,
  request: RequestKey,
  connection: PantryConnection,
  reason: "product_missing" | "unit_mismatch" | "tare_enabled",
  clock: { now(): Date },
) {
  return writeTransaction(database, (scope) => {
    const database = scopeDatabase(scope);
    if (!connectionCurrent(database, connection)) return false;
    const now = clock.now().toISOString();
    const [rejected] = rejectQuery(
      database,
      { reason, now },
      {
        ...request,
        user_id: connection.user_id,
        generation: connection.generation,
      },
    );
    if (!rejected) return false;
    insertLocalRejection(database, {
      request_id: rejected.id,
      number: rejected.attempt_count,
      reason,
      finished_at: now,
    });
    return true;
  });
}

function settle(claim: Claim, result: ConsumeResult) {
  const failure = (state: RequestState, reason: string) => ({
    state,
    outcome: state === "pending" ? "not_sent" : state,
    reason,
    http_status:
      result && "httpStatus" in result ? (result.httpStatus ?? null) : null,
    receipt: null,
  });
  if (result?.status === "confirmed") {
    if (
      !result.value.every((booking) => booking.product_id === claim.product_id)
    )
      return failure("uncertain", "invalid_response");
    return {
      state: "delivered",
      outcome: "confirmed",
      reason: null,
      http_status: null,
      receipt: JSON.stringify(
        result.value.map(({ id, transaction_id }) => ({ id, transaction_id })),
      ),
    };
  }
  const reason =
    result && "reason" in result ? result.reason : "response_withheld";
  if (result?.status === "not_sent") return failure("pending", reason);
  if (result?.status === "rejected") return failure("rejected", reason);
  // Anything after invocation that is not a confirmed booking may have consumed stock.
  return failure("uncertain", reason);
}

/** Records one client result against its own claim; false when the token no longer holds the request. */
export function finalizeClaim(
  database: Database,
  claim: Claim,
  result: ConsumeResult,
  clock: { now(): Date },
) {
  const settled = settle(claim, result);
  return writeTransaction(database, (scope) => {
    const database = scopeDatabase(scope);
    const now = clock.now().toISOString();
    const [updated] = finalizeRequest(
      database,
      { state: settled.state, reason: settled.reason, now },
      { id: claim.id, claim_token: claim.claim_token },
    );
    if (!updated) return false;
    finalizeAttempt(
      database,
      {
        outcome: settled.outcome,
        reason: settled.reason,
        http_status: settled.http_status,
        receipt: settled.receipt,
        finished_at: now,
      },
      { token: claim.claim_token },
    );
    return true;
  });
}

/**
 * Startup step: claims from a previous process may have been sent, and a restored backup may hold work already sent.
 * Each recovered request gets a new numbered recovery record and a fresh settling wait; valid uncertain rows are left alone.
 */
export function recoverRequests(database: Database, clock: { now(): Date }) {
  writeTransaction(database, (scope) => {
    const database = scopeDatabase(scope);
    const now = clock.now().toISOString();
    recoverAttempts(database, { finished_at: now, uncertain_since: now });
    recoverRecords(database, { now });
    recoverQuery(database, { uncertain_since: now, updated_at: now });
    recoverGroceries(scope, now);
    clearBackupMarker(database);
  });
}
