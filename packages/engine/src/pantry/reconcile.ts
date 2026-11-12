import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { z } from "zod";
import { afterCommit, scopeDatabase, writeTransaction } from "../db.ts";
import { OperationError } from "../operations/registry.ts";
import { insertDecision } from "../queries/pantry/insert-decision.ts";
import { listAttempts } from "../queries/pantry/list-attempts.ts";
import { listDecisions } from "../queries/pantry/list-decisions.ts";
import { listResolvedRequests } from "../queries/pantry/list-resolved-requests.ts";
import { listUnresolvedRequests } from "../queries/pantry/list-unresolved-requests.ts";
import { readConnection } from "../queries/pantry/read-connection.ts";
import { readDecision } from "../queries/pantry/read-decision.ts";
import {
  type ReadRequestResult,
  readRequest,
} from "../queries/pantry/read-request.ts";
import { resolveRequest } from "../queries/pantry/resolve-request.ts";
import { selectIntakeEntry } from "../queries/select-intake-entry.ts";

// A fixed wait lowers the chance that a slow Grocy write lands after a retry; it is not a vendor guarantee.
const settlingMs = 15 * 60 * 1000;
const historyMs = 30 * 24 * 60 * 60 * 1000;
const decisions = ["delivered", "not_delivered_retry", "abandoned"] as const;
const resulting = {
  delivered: "delivered",
  not_delivered_retry: "pending",
  abandoned: "abandoned",
} as const;
const retryErrors = {
  not_actionable: [409, "pantry_request_not_actionable"],
  reset_required: [503, "pantry_reset_required"],
  connection_changed: [409, "pantry_connection_changed"],
  in_flight: [409, "pantry_request_in_flight"],
  too_early: [409, "pantry_retry_too_early"],
} as const;
type RetryReason = keyof typeof retryErrors;

const number = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const nullableNumber = z.number().nullable();
const text = z.string().nullable();
// Non-strict so a retained snapshot's extra fields are dropped from the response.
const intakeSnapshot = z.object({
  name: text,
  servings: nullableNumber,
  eaten_at: z.string(),
  kcal: nullableNumber,
  protein_g: nullableNumber,
  carbs_g: nullableNumber,
  fat_g: nullableNumber,
  fiber_g: nullableNumber,
});
const booking = z.strictObject({ id: number, transaction_id: z.string() });
const decisionReceipt = z.strictObject({
  decision_id: z.uuid(),
  request_id: z.uuid(),
  number,
  kind: z.enum(["attempt_resolution", "pending_abandon"]),
  decision: z.enum(decisions),
  mutation_id: z.string(),
  created_at: z.string(),
  resulting_state: z.enum(["pending", "delivered", "abandoned"]),
});
const pantryRequest = z.strictObject({
  request_id: z.uuid(),
  generation: number,
  predecessor_owner: z.boolean(),
  state: z.enum([
    "pending",
    "sending",
    "uncertain",
    "rejected",
    "delivered",
    "cancelled",
    "abandoned",
  ]),
  current_number: number,
  created_at: z.string(),
  updated_at: text,
  resolved_at: text,
  frozen: z.strictObject({
    product_id: number,
    stock_unit_id: number,
    quantity_per_serving: z.number().positive(),
    quantity: z.number().positive(),
  }),
  reference: z.strictObject({
    kind: z.enum(["food", "source_food"]),
    id: number,
  }),
  intake: intakeSnapshot.nullable(),
  edit_notice: z.strictObject({ servings: z.number() }).nullable(),
  error: z.strictObject({ reason: z.string() }).nullable(),
  retry: z.strictObject({
    eligible: z.boolean(),
    not_before: text,
    reason: z.enum(Object.keys(retryErrors) as [RetryReason]).nullable(),
  }),
  attempts: z.array(
    z.strictObject({
      number,
      kind: z.enum(["network", "local_rejection", "recovery"]),
      recovered_from_number: number.nullable(),
      outcome: z.string(),
      reason: text,
      http_status: z.number().int().nullable(),
      started_at: text,
      finished_at: text,
      uncertain_since: text,
      bookings: z.array(booking).nullable(),
    }),
  ),
  decisions: z.array(decisionReceipt.omit({ request_id: true })),
});
export const pantryRequestsOutput = z.strictObject({
  state: z.enum(["disabled", "ready", "reset_required"]),
  unresolved: z.array(pantryRequest),
  history: z.array(pantryRequest),
});
export const reconcileInput = z.strictObject({
  request_id: z.uuid(),
  attempt_number: number,
  mutation_id: z.string().trim().min(1).max(100),
  decision: z.enum(decisions),
});
export const reconcileOutput = decisionReceipt;

type Decision = NonNullable<ReturnType<typeof readDecision>[number]>;
const receipt = (row: Decision) => ({
  decision_id: row.id,
  request_id: row.request_id,
  number: row.number,
  kind: row.kind,
  decision: row.decision,
  mutation_id: row.mutation_id,
  created_at: row.created_at,
  resulting_state: row.resulting_state,
});

/** Lists and resolves stock requests from every owner and generation; the service authorizes the caller first. */
export function createReconciliation({
  database,
  ownerId,
  clock,
  stopping,
  dispatch,
  refresh,
  report,
}: {
  database: Database;
  ownerId: number;
  clock: { now(): Date };
  stopping(): boolean;
  dispatch?: {
    kick(): void;
    holds(requestId: string, number: number): boolean;
  };
  refresh(): unknown;
  report(code: string): void;
}) {
  function retry(database: Database, request: ReadRequestResult, now: Date) {
    const blocked = (reason: RetryReason, notBefore: string | null = null) => ({
      eligible: false,
      not_before: notBefore,
      reason,
    });
    if (request.state !== "uncertain" && request.state !== "rejected")
      return blocked("not_actionable");
    const row = readConnection(database);
    if (!row || row.reset_required) return blocked("reset_required");
    if (
      row.user_id !== request.user_id ||
      row.generation !== request.generation
    )
      return blocked("connection_changed");
    if (dispatch?.holds(request.id, request.attempt_count))
      return blocked("in_flight");
    if (request.state === "rejected")
      return { eligible: true, not_before: null, reason: null };
    if (request.uncertain_since === null) return blocked("too_early");
    const attempts = listAttempts(database, { request_id: request.id });
    const find = (number: number | null | undefined) =>
      attempts.find((attempt) => attempt.number === number);
    const current = find(request.attempt_count);
    // A recovery record has no send time of its own; the send it recovered from does.
    const sent =
      current?.started_at ?? find(current?.recovered_from_number)?.started_at;
    const since = Math.max(
      Date.parse(request.uncertain_since),
      Date.parse(sent ?? request.uncertain_since),
    );
    const notBefore = new Date(since + settlingMs).toISOString();
    return now.getTime() < since + settlingMs
      ? blocked("too_early", notBefore)
      : { eligible: true, not_before: notBefore, reason: null };
  }

  function intake(request: ReadRequestResult) {
    const snapshot =
      request.intake_id === null
        ? JSON.parse(request.detached_intake ?? "null")
        : selectIntakeEntry(database, {
            user_id: request.user_id,
            id: request.intake_id,
          });
    return intakeSnapshot.nullable().parse(snapshot);
  }

  function view(request: ReadRequestResult, now: Date) {
    return {
      request_id: request.id,
      generation: request.generation,
      predecessor_owner: request.user_id !== ownerId,
      state: request.state,
      current_number: request.attempt_count,
      created_at: request.created_at,
      updated_at: request.updated_at,
      resolved_at: request.resolved_at,
      frozen: {
        product_id: request.product_id,
        stock_unit_id: request.stock_unit_id,
        quantity_per_serving: request.quantity_per_serving,
        quantity: request.quantity,
      },
      reference: { kind: request.reference_kind, id: request.reference_id },
      intake: intake(request),
      edit_notice:
        request.edited_servings === null
          ? null
          : { servings: request.edited_servings },
      error: request.reason === null ? null : { reason: request.reason },
      retry: retry(database, request, now),
      attempts: listAttempts(database, { request_id: request.id }).map(
        ({ request_id, token, receipt, ...attempt }) => ({
          ...attempt,
          bookings:
            receipt === null
              ? null
              : z.array(booking).parse(JSON.parse(receipt)),
        }),
      ),
      decisions: listDecisions(database, { request_id: request.id }).map(
        (row) => {
          const { request_id: _request, ...rest } = receipt(row);
          return rest;
        },
      ),
    };
  }

  return {
    list() {
      const now = clock.now();
      const row = readConnection(database);
      return {
        state: row?.reset_required ? "reset_required" : "ready",
        unresolved: listUnresolvedRequests(database).map((request) =>
          view(request, now),
        ),
        history: listResolvedRequests(database, {
          since: new Date(now.getTime() - historyMs).toISOString(),
        }).map((request) => view(request, now)),
      };
    },
    decide(actorId: number, input: z.output<typeof reconcileInput>) {
      return writeTransaction(database, (scope) => {
        const database = scopeDatabase(scope);
        const [prior] = readDecision(database, {
          user_id: actorId,
          mutation_id: input.mutation_id,
        });
        if (prior) {
          if (
            prior.request_id !== input.request_id ||
            prior.number !== input.attempt_number ||
            prior.decision !== input.decision
          )
            throw new OperationError(409, "mutation_conflict");
          return receipt(prior);
        }
        if (stopping()) throw new OperationError(503, "pantry_stopping");
        const [request] = readRequest(database, { id: input.request_id });
        if (!request) throw new OperationError(404, "pantry_request_not_found");
        if (request.attempt_count !== input.attempt_number)
          throw new OperationError(409, "pantry_stale_attempt");
        const pending = request.state === "pending";
        if (
          pending
            ? input.decision !== "abandoned"
            : request.state !== "uncertain" && request.state !== "rejected"
        )
          throw new OperationError(409, "pantry_request_not_actionable");
        const now = clock.now();
        if (input.decision === "not_delivered_retry") {
          const { reason } = retry(database, request, now);
          if (reason) {
            const [status, code] = retryErrors[reason];
            throw new OperationError(status, code);
          }
        }
        const state = resulting[input.decision];
        const [moved] = resolveRequest(
          database,
          { state, now: now.toISOString() },
          {
            id: request.id,
            expected: request.state,
            number: request.attempt_count,
          },
        );
        const decision = moved
          ? insertDecision(database, {
              id: randomUUID(),
              request_id: request.id,
              user_id: actorId,
              mutation_id: input.mutation_id,
              number: request.attempt_count,
              kind: pending ? "pending_abandon" : "attempt_resolution",
              decision: input.decision,
              resulting_state: state,
              created_at: now.toISOString(),
            })
          : null;
        if (!decision) throw new OperationError(409, "pantry_stale_attempt");
        const failed = () => report("pantry_decision_followup_failed");
        if (state === "pending" && dispatch)
          afterCommit(scope, dispatch.kick, failed);
        const row = readConnection(database);
        // Only the active connection's own stock can show the delivery.
        if (
          state === "delivered" &&
          row &&
          !row.reset_required &&
          row.user_id === request.user_id &&
          row.generation === request.generation
        )
          afterCommit(scope, refresh, failed);
        return receipt(decision);
      });
    },
  };
}
