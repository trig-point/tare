import { createHash, randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { scopeDatabase, type WriteScope, writeTransaction } from "../db.ts";
import { insertOwnedFood, type OwnedFoodValues } from "../foods/create.ts";
import type { GrocyResult } from "../grocy/client.ts";
import type { PurchaseReceipt } from "../grocy/grocery.ts";
import { nutrientKeys } from "../logging/schemas.ts";
import { OperationError } from "../operations/registry.ts";
import { abandonRequest } from "../queries/grocery/abandon-request.ts";
import { abandonSteps } from "../queries/grocery/abandon-steps.ts";
import { adoptStep } from "../queries/grocery/adopt-step.ts";
import { claimStep } from "../queries/grocery/claim-step.ts";
import { countOpen } from "../queries/grocery/count-open.ts";
import { finalizeStep } from "../queries/grocery/finalize-step.ts";
import { insertBindingAbsent } from "../queries/grocery/insert-binding-absent.ts";
import { insertDecision } from "../queries/grocery/insert-decision.ts";
import { insertRequest } from "../queries/grocery/insert-request.ts";
import { insertStep } from "../queries/grocery/insert-step.ts";
import { listOpen } from "../queries/grocery/list-open.ts";
import { listSteps } from "../queries/grocery/list-steps.ts";
import { readBindingToken } from "../queries/grocery/read-binding-token.ts";
import { readDecision } from "../queries/grocery/read-decision.ts";
import { readNonce } from "../queries/grocery/read-nonce.ts";
import { readRequest } from "../queries/grocery/read-request.ts";
import { readRequestById } from "../queries/grocery/read-request-by-id.ts";
import { recoverSteps } from "../queries/grocery/recover-steps.ts";
import { replaceBinding } from "../queries/grocery/replace-binding.ts";
import { reserveTransaction } from "../queries/grocery/reserve-transaction.ts";
import { rotateNonce } from "../queries/grocery/rotate-nonce.ts";
import { setRequestState } from "../queries/grocery/set-request-state.ts";
import { readConnection } from "../queries/pantry/read-connection.ts";
import { selectFood } from "../queries/select-food.ts";

type Clock = { now(): Date };
export const stepOrder = [
  "unit",
  "location",
  "product",
  "barcode",
  "stock_add",
] as const;
export type StepKind = (typeof stepOrder)[number];
export type GroceryRequest = NonNullable<ReturnType<typeof readRequestById>>;
export type StepClaim = {
  request_id: number;
  number: number;
  kind: StepKind;
  claim_token: string;
};
export type StepResult =
  | GrocyResult<number>
  | GrocyResult<PurchaseReceipt>
  | undefined;

const sha256 = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Serving basis and nutrients; a reused food must still match this before binding. */
export function foodFingerprint(
  food: { serving_size: number | null; serving_unit: string | null } & Record<
    (typeof nutrientKeys)[number],
    number | null
  >,
) {
  return sha256([
    food.serving_size,
    food.serving_unit,
    ...nutrientKeys.map((key) => food[key]),
  ]);
}

export function currentNonce(database: Database) {
  const row = readNonce(database);
  if (!row) throw new Error("Grocery restore nonce missing");
  return row.nonce;
}

export function readGrocery(
  database: Database,
  userId: number,
  mutationId: string,
) {
  const request = readRequest(database, {
    user_id: userId,
    mutation_id: mutationId.toLowerCase(),
  });
  return request
    ? { request, steps: listSteps(database, { request_id: request.id }) }
    : null;
}

/** Minimal blocker rows for the reset screen, including a previous owner's or generation's. */
export const openGroceries = (database: Database, limit = 50) =>
  listOpen(database, { limit });

/** The request's original connection and generation are still live under this restore nonce. */
function live(database: Database, request: GroceryRequest, nonce: string) {
  const row = readConnection(database);
  return (
    !!row &&
    !row.reset_required &&
    request.generation === row.generation &&
    request.user_id === row.user_id &&
    request.url === row.url &&
    request.username === row.username &&
    nonce === currentNonce(database)
  );
}

/**
 * Stores the confirmed plan, its numbered steps and the new or reused food in the caller's
 * transaction. A known UUID replays before any other check; a changed plan conflicts.
 */
export function insertGroceryRequest(
  scope: WriteScope,
  input: {
    ownerId: number | null;
    userId: number;
    mutationId: string;
    planHash: string;
    plan: string;
    restoreNonce: string;
    steps: readonly StepKind[];
    food: { food_id: number } | { values: OwnedFoodValues };
  },
  clock: Clock,
) {
  const database = scopeDatabase(scope);
  const mutationId = input.mutationId.toLowerCase();
  const prior = readGrocery(database, input.userId, mutationId);
  if (prior) {
    if (prior.request.plan_hash !== input.planHash)
      throw new OperationError(409, "grocery_conflict");
    return { ...prior, created: false };
  }
  if (input.userId !== input.ownerId)
    throw new OperationError(403, "forbidden");
  const row = readConnection(database);
  if (!row || row.reset_required || row.user_id !== input.ownerId)
    throw new OperationError(503, "pantry_reset_required");
  if (input.restoreNonce !== currentNonce(database))
    throw new OperationError(409, "grocery_restored");
  const ranks = input.steps.map((kind) => stepOrder.indexOf(kind));
  if (
    ranks.at(-1) !== stepOrder.indexOf("stock_add") ||
    ranks.some((rank, index) => index > 0 && rank <= (ranks[index - 1] ?? -1))
  )
    throw new OperationError(400, "invalid_request");
  const food =
    "food_id" in input.food
      ? selectFood(database, { user_id: input.userId, id: input.food.food_id })
      : insertOwnedFood(scope, input.userId, input.food.values);
  if (!food) throw new OperationError(404, "food_not_found");
  const now = clock.now().toISOString();
  const request = insertRequest(database, {
    user_id: input.userId,
    mutation_id: mutationId,
    plan_hash: input.planHash,
    plan: input.plan,
    generation: row.generation,
    url: row.url,
    username: row.username,
    restore_nonce: input.restoreNonce,
    food_id: food.id,
    food_fingerprint: foodFingerprint(food),
    created_at: now,
  });
  if (!request) throw new Error("Grocery insert returned no row");
  input.steps.forEach((kind, index) => {
    insertStep(database, {
      request_id: request.id,
      number: index + 1,
      kind,
      updated_at: now,
    });
  });
  return {
    request,
    steps: listSteps(database, { request_id: request.id }),
    created: true,
  };
}

/**
 * Claims the next step for one send. A stock add must carry the product and the stock_log
 * maximum proved just before, stored with the claim. Null means the step is not claimable.
 */
export function claimGroceryStep(
  database: Database,
  step: { request_id: number; number: number },
  clock: Clock,
  add?: { product_id: number; stock_log_max: number },
): StepClaim | null {
  return writeTransaction(database, (scope) => {
    const database = scopeDatabase(scope);
    const request = readRequestById(database, { id: step.request_id });
    if (!request || !live(database, request, request.restore_nonce))
      return null;
    const [claimed] = claimStep(
      database,
      {
        claim_token: randomUUID(),
        product_id: add?.product_id ?? null,
        stock_log_max: add?.stock_log_max ?? null,
        now: clock.now().toISOString(),
      },
      step,
    );
    if (!claimed) return null;
    if ((claimed.kind === "stock_add") !== (add !== undefined))
      throw new Error("Stock add claims need a proved stock_log maximum");
    return claimed as StepClaim;
  });
}

const outcome = (
  state: string,
  reason: string | null,
  receipt: { object_id?: number; transaction_id?: string } = {},
) => ({
  state,
  reason,
  object_id: receipt.object_id ?? null,
  transaction_id: receipt.transaction_id ?? null,
});

function settle(kind: StepKind, result: StepResult) {
  if (result?.status === "ok" || result?.status === "confirmed") {
    const { value } = result;
    if (kind === "stock_add" && typeof value === "object")
      return outcome("confirmed", null, {
        transaction_id: value.transactionId,
      });
    if (kind !== "stock_add" && typeof value === "number")
      return outcome("confirmed", null, { object_id: value });
    return outcome("uncertain", "invalid_response");
  }
  const reason =
    result && "reason" in result ? result.reason : "response_withheld";
  if (result?.status === "not_sent") return outcome("pending", reason);
  if (result?.status === "rejected") return outcome("rejected", reason);
  // Anything after the claim that is not a valid receipt may have written.
  return outcome("uncertain", reason);
}

class StaleClaim extends Error {}

/**
 * Records one send's result against its own claim token; false when the claim no longer
 * holds. A confirmed add reserves its transaction id and leaves only the local binding.
 */
export function finalizeGroceryStep(
  database: Database,
  claim: StepClaim,
  result: StepResult,
  clock: Clock,
) {
  const settled = settle(claim.kind, result);
  try {
    return writeTransaction(database, (scope) => {
      const database = scopeDatabase(scope);
      const now = clock.now().toISOString();
      const reserved =
        settled.transaction_id === null ||
        reserveTransaction(database, {
          transaction_id: settled.transaction_id,
          request_id: claim.request_id,
          step_number: claim.number,
        }) !== null;
      const [updated] = finalizeStep(
        database,
        {
          ...(reserved
            ? settled
            : outcome("uncertain", "transaction_reserved")),
          now,
        },
        { claim_token: claim.claim_token },
      );
      // Rolls back a reservation made for a claim that no longer holds.
      if (!updated) throw new StaleClaim();
      if (settled.transaction_id !== null && reserved)
        setRequestState(
          database,
          { state: "binding_pending", now },
          { id: claim.request_id, expected_state: "open" },
        );
      return true;
    });
  } catch (caught) {
    if (caught instanceof StaleClaim) return false;
    throw caught;
  }
}

/** Replays a recorded decision before any state check; otherwise runs `act` and records it. */
function decide(
  database: Database,
  decision: {
    userId: number;
    mutationId: string;
    requestId: number;
    stepNumber: number | null;
    kind: "adopt" | "abandon" | "bind";
    input: unknown;
  },
  clock: Clock,
  act: (database: Database, request: GroceryRequest, now: string) => string,
) {
  const key = {
    user_id: decision.userId,
    mutation_id: decision.mutationId.toLowerCase(),
  };
  const decisionHash = sha256([
    decision.kind,
    decision.requestId,
    decision.stepNumber,
    decision.input,
  ]);
  return writeTransaction(database, (scope) => {
    const database = scopeDatabase(scope);
    const prior = readDecision(database, key);
    if (prior) {
      if (prior.decision_hash !== decisionHash)
        throw new OperationError(409, "decision_conflict");
      return { state: prior.resulting_state, replayed: true };
    }
    const request = readRequestById(database, { id: decision.requestId });
    if (!request) throw new OperationError(404, "grocery_not_found");
    const now = clock.now().toISOString();
    const state = act(database, request, now);
    insertDecision(database, {
      ...key,
      decision_hash: decisionHash,
      request_id: request.id,
      step_number: decision.stepNumber,
      decision: decision.kind,
      resulting_state: state,
      created_at: now,
    });
    return { state, replayed: false };
  });
}

function requireOwner(
  ownerId: number | null,
  userId: number,
  request?: GroceryRequest,
) {
  if (userId !== ownerId || (request && request.user_id !== userId))
    throw new OperationError(403, "forbidden");
}

/**
 * Accepts a caller-verified object id or purchase transaction for an uncertain step. Needs the
 * current restore nonce and the request's original connection and generation.
 */
export function adoptGroceryStep(
  database: Database,
  input: {
    ownerId: number | null;
    userId: number;
    mutationId: string;
    requestId: number;
    number: number;
    restoreNonce: string;
    proof: { object_id: number } | { transaction_id: string };
  },
  clock: Clock,
) {
  return decide(
    database,
    {
      userId: input.userId,
      mutationId: input.mutationId,
      requestId: input.requestId,
      stepNumber: input.number,
      kind: "adopt",
      input: input.proof,
    },
    clock,
    (database, request, now) => {
      requireOwner(input.ownerId, input.userId, request);
      if (!live(database, request, input.restoreNonce))
        throw new OperationError(409, "grocery_connection_changed");
      const transactionId =
        "transaction_id" in input.proof ? input.proof.transaction_id : null;
      if (
        transactionId !== null &&
        !reserveTransaction(database, {
          transaction_id: transactionId,
          request_id: request.id,
          step_number: input.number,
        })
      )
        throw new OperationError(409, "grocery_transaction_reserved");
      const [adopted] = adoptStep(
        database,
        {
          object_id: "object_id" in input.proof ? input.proof.object_id : null,
          transaction_id: transactionId,
          now,
        },
        { request_id: request.id, number: input.number },
      );
      if (
        !adopted ||
        (adopted.kind === "stock_add") !== (transactionId !== null)
      )
        throw new OperationError(409, "grocery_step_not_uncertain");
      if (transactionId === null) return request.state;
      setRequestState(
        database,
        { state: "binding_pending", now },
        { id: request.id, expected_state: "open" },
      );
      return "binding_pending";
    },
  );
}

/**
 * Stops local work with no external write; works while reset is required and on a previous
 * owner's request, but only for the configured owner and never while a step is sending.
 */
export function abandonGrocery(
  database: Database,
  input: {
    ownerId: number | null;
    userId: number;
    mutationId: string;
    requestId: number;
  },
  clock: Clock,
) {
  return decide(
    database,
    { ...input, stepNumber: null, kind: "abandon", input: null },
    clock,
    (database, request, now) => {
      requireOwner(input.ownerId, input.userId);
      if (!abandonRequest(database, { now }, { id: request.id }).length)
        throw new OperationError(409, "grocery_not_abandonable");
      abandonSteps(database, { now }, { request_id: request.id });
      return "abandoned";
    },
  );
}

/**
 * Binds the request's food to its purchased product only if the binding is still what the
 * caller saw (absent, or the same token and status) and the food is unchanged.
 */
export function bindGrocery(
  database: Database,
  input: {
    ownerId: number | null;
    userId: number;
    mutationId: string;
    requestId: number;
    restoreNonce: string;
    expected: { change_token: string; status: string } | null;
    binding: {
      product_id: number;
      stock_unit_id: number;
      quantity_per_serving: number;
    };
  },
  clock: Clock,
) {
  return decide(
    database,
    {
      ...input,
      stepNumber: null,
      kind: "bind",
      input: [input.expected, input.binding],
    },
    clock,
    (database, request, now) => {
      requireOwner(input.ownerId, input.userId, request);
      if (request.state !== "binding_pending")
        throw new OperationError(409, "grocery_not_binding");
      if (!live(database, request, input.restoreNonce))
        throw new OperationError(409, "grocery_connection_changed");
      const added = listSteps(database, { request_id: request.id }).find(
        (step) => step.kind === "stock_add",
      );
      if (added?.product_id !== input.binding.product_id)
        throw new OperationError(409, "grocery_product_mismatch");
      const food = selectFood(database, {
        user_id: request.user_id,
        id: request.food_id,
      });
      if (!food || foodFingerprint(food) !== request.food_fingerprint)
        throw new OperationError(409, "grocery_food_changed");
      const key = {
        user_id: request.user_id,
        generation: request.generation,
        reference_id: request.food_id,
      };
      const values = { ...key, ...input.binding, change_token: randomUUID() };
      const saved = input.expected
        ? replaceBinding(database, values, {
            ...key,
            expected_token: input.expected.change_token,
            expected_status: input.expected.status,
          })[0]
        : insertBindingAbsent(database, values);
      if (!saved) throw new OperationError(409, "grocery_binding_changed");
      setRequestState(
        database,
        { state: "completed", now },
        { id: request.id, expected_state: "binding_pending" },
      );
      return "completed";
    },
  );
}

/** The binding a later bindGrocery call must still find, or null when it must stay absent. */
export const groceryBinding = (database: Database, request: GroceryRequest) =>
  readBindingToken(database, {
    user_id: request.user_id,
    generation: request.generation,
    reference_id: request.food_id,
  });

/** Startup, inside the transaction that consumes the backup marker and before its clear. */
export function recoverGroceries(scope: WriteScope, now: string) {
  const database = scopeDatabase(scope);
  recoverSteps(database, { now });
  rotateNonce(database, { nonce: randomUUID().replaceAll("-", "") });
}

export const openGroceryCount = (database: Database) =>
  countOpen(database)?.open ?? 0;
