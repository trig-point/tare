import { createHash, randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { scopeDatabase, type WriteScope, writeTransaction } from "../db.ts";
import { insertOwnedFood, type OwnedFoodValues } from "../foods/create.ts";
import type { GrocyResult } from "../grocy/client.ts";
import type { PurchaseReceipt } from "../grocy/grocery.ts";
import { nutrientKeys } from "../logging/schemas.ts";
import { OperationError } from "../operations/registry.ts";
import { claimStep } from "../queries/grocery/claim-step.ts";
import { countOpen } from "../queries/grocery/count-open.ts";
import { finalizeStep } from "../queries/grocery/finalize-step.ts";
import { insertRequest } from "../queries/grocery/insert-request.ts";
import { insertStep } from "../queries/grocery/insert-step.ts";
import { listOpen } from "../queries/grocery/list-open.ts";
import { listSteps } from "../queries/grocery/list-steps.ts";
import { readNonce } from "../queries/grocery/read-nonce.ts";
import { readRequest } from "../queries/grocery/read-request.ts";
import { readRequestById } from "../queries/grocery/read-request-by-id.ts";
import { recoverSteps } from "../queries/grocery/recover-steps.ts";
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

/** Startup, inside the transaction that consumes the backup marker and before its clear. */
export function recoverGroceries(scope: WriteScope, now: string) {
  const database = scopeDatabase(scope);
  recoverSteps(database, { now });
  rotateNonce(database, { nonce: randomUUID().replaceAll("-", "") });
}

export const openGroceryCount = (database: Database) =>
  countOpen(database)?.open ?? 0;
