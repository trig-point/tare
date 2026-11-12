import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import { readRequest } from "../queries/pantry/read-request.ts";
import { readRequestByClient } from "../queries/pantry/read-request-by-client.ts";
import type { StockOutcome } from "./requests.ts";

/** The stock part of a logging response: a no-request reason, or the request's state and frozen amount. */
export const stockResult = zod.strictObject({
  request_id: zod.string().nullable(),
  state: zod
    .enum([
      "pending",
      "sending",
      "uncertain",
      "rejected",
      "delivered",
      "cancelled",
      "abandoned",
    ])
    .nullable(),
  reason: zod.string().nullable(),
  product_id: zod.number().int().positive().nullable(),
  stock_unit_id: zod.number().int().positive().nullable(),
  quantity: zod.number().positive().nullable(),
  edited_servings: zod.number().positive().nullable(),
});
export type StockResult = zod.infer<typeof stockResult>;

type Request = ReturnType<typeof readRequest>[number];
function view(reason: string | null, request?: Request): StockResult {
  return {
    request_id: request?.id ?? null,
    state: (request?.state ?? null) as StockResult["state"],
    reason: request ? request.reason : reason,
    product_id: request?.product_id ?? null,
    stock_unit_id: request?.stock_unit_id ?? null,
    quantity: request?.quantity ?? null,
    edited_servings: request?.edited_servings ?? null,
  };
}

/** Expects an outcome already read for its owner; null means the intake has no stock to report. */
export function stockView(
  database: Database,
  outcome: StockOutcome | null,
): StockResult | undefined {
  if (!outcome) return undefined;
  if (outcome.request_id === null) return view(outcome.reason);
  return view(null, readRequest(database, { id: outcome.request_id })[0]);
}

/** A deleted intake keeps its request under the original client id. */
export function retainedStock(
  database: Database,
  userId: number,
  clientId: string,
): StockResult | undefined {
  const [key] = readRequestByClient(database, {
    user_id: userId,
    client_id: clientId,
  });
  const [request] = key ? readRequest(database, { id: key.id }) : [];
  return request && view(null, request);
}
