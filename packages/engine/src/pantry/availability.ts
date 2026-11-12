import type { Database } from "better-sqlite3";
import { z } from "zod";
import { listStockRequests } from "../queries/pantry/list-stock-requests.ts";

const identifier = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const pantryError = z.strictObject({
  reason: z.enum([
    "disabled",
    "not_owner",
    "invalid_input",
    "unauthorized",
    "not_found",
    "http",
    "invalid_response",
    "transport",
    "timeout",
    "too_large",
    "response_withheld",
  ]),
  http_status: z.number().int().optional(),
});
export const bindingStatus = z.enum([
  "valid",
  "product_missing",
  "unit_mismatch",
  "tare_enabled",
]);
const amount = z.number().finite().nullable();
const buckets = [
  "pending",
  "sending_after",
  "sending_before_or_equal",
  "delivered_after_or_equal",
  "uncertain",
  "rejected",
] as const;
type Bucket = (typeof buckets)[number];
/** Advisory stock for one bound food, compared with the last successful fetch; never a reservation. */
export const availabilitySchema = z.strictObject({
  reasons: z.array(
    z.enum(["unavailable", "unknown", "stale", "uncertain", "short"]),
  ),
  stock_unit_id: identifier.nullable(),
  binding_status: bindingStatus.nullable(),
  raw: amount,
  deducted: amount,
  adjusted: amount,
  needed: amount,
  shortfall: amount,
  fetch_started_at: z.string().nullable(),
  last_success_at: z.string().nullable(),
  stale: z.boolean(),
  error: pantryError.nullable(),
  uncertain: z.boolean(),
  unknown: z.boolean(),
  timing_unknown: z.boolean(),
  unit_mismatch: z.boolean(),
  state_amounts: z.strictObject(
    Object.fromEntries(buckets.map((bucket) => [bucket, amount])) as Record<
      Bucket,
      typeof amount
    >,
  ),
});
export type Availability = z.infer<typeof availabilitySchema>;
export type Snapshot = {
  fetch_started_at: string | null;
  last_success_at: string | null;
  stale: boolean;
  error: z.infer<typeof pantryError> | null;
  products: {
    product_id: number;
    amount: number;
    stock_unit: { id: number };
  }[];
};
type Binding = {
  product_id: number;
  stock_unit_id: number;
  quantity_per_serving: number;
  status: string;
};
export type StockRequest = ReturnType<typeof listStockRequests>[number];

const canonical = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function instant(value: string | null) {
  if (value === null || !canonical.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
const finite = (value: number | null) =>
  value !== null && Number.isFinite(value) ? value : null;

/** Current requests for the generation; delivered ones only when confirmed at or after the fetch, or untimed. */
export function stockRequests(
  database: Database,
  userId: number,
  generation: number,
  fetchStartedAt: string | null,
) {
  return listStockRequests(database, {
    user_id: userId,
    generation,
    fetch_started_at: fetchStartedAt ?? "",
  });
}

/** Reset, stop or an unestablished connection: nothing about the food's stock can be said. */
export function unavailableAvailability(): Availability {
  return {
    reasons: ["unavailable", "unknown", "stale"],
    stock_unit_id: null,
    binding_status: null,
    raw: null,
    deducted: null,
    adjusted: null,
    needed: null,
    shortfall: null,
    fetch_started_at: null,
    last_success_at: null,
    stale: true,
    error: null,
    uncertain: false,
    unknown: true,
    timing_unknown: false,
    unit_mismatch: false,
    state_amounts: Object.fromEntries(
      buckets.map((bucket) => [bucket, null]),
    ) as Availability["state_amounts"],
  };
}

export function assessAvailability(
  snapshot: Snapshot,
  binding: Binding,
  requests: StockRequest[],
  servings: number,
): Availability {
  const product = snapshot.products.find(
    (row) => row.product_id === binding.product_id,
  );
  const valid = binding.status === "valid";
  const bindingMismatch =
    binding.status === "unit_mismatch" ||
    (product !== undefined && product.stock_unit.id !== binding.stock_unit_id);
  // A successful snapshot lists every active product in stock, so a missing valid product has none.
  const raw = product
    ? product.amount
    : snapshot.last_success_at !== null && valid
      ? 0
      : null;
  const unit = product
    ? product.stock_unit.id
    : raw === null
      ? null
      : binding.stock_unit_id;
  const comparable = unit ?? binding.stock_unit_id;
  const fetch = instant(snapshot.fetch_started_at);
  const amounts: Record<Bucket, number | null> = {
    pending: 0,
    sending_after: 0,
    sending_before_or_equal: 0,
    delivered_after_or_equal: 0,
    uncertain: 0,
    rejected: 0,
  };
  const add = (bucket: Bucket, quantity: number) => {
    const current = amounts[bucket];
    amounts[bucket] = current === null ? null : current + quantity;
  };
  let uncertain = false;
  let timingUnknown = false;
  let requestMismatch = false;
  for (const request of requests) {
    if (request.product_id !== binding.product_id) continue;
    const affected: Bucket[] =
      request.state === "sending"
        ? ["sending_after", "sending_before_or_equal"]
        : request.state === "delivered"
          ? ["delivered_after_or_equal"]
          : [request.state as Bucket];
    if (request.stock_unit_id !== comparable) {
      for (const bucket of affected) amounts[bucket] = null;
      if (request.state !== "rejected") requestMismatch = true;
      continue;
    }
    if (request.state === "pending" || request.state === "rejected")
      add(request.state, request.quantity);
    else if (request.state === "uncertain") {
      add("uncertain", request.quantity);
      uncertain = true;
    } else {
      const time = instant(
        request.state === "sending" ? request.sent_at : request.confirmed_at,
      );
      if (time === null || fetch === null) {
        for (const bucket of affected) amounts[bucket] = null;
        timingUnknown = true;
      } else if (request.state === "sending") {
        add(
          time > fetch ? "sending_after" : "sending_before_or_equal",
          request.quantity,
        );
        uncertain ||= time <= fetch;
      } else if (time >= fetch) {
        add("delivered_after_or_equal", request.quantity);
        uncertain = true;
      }
    }
  }
  for (const bucket of buckets) amounts[bucket] = finite(amounts[bucket]);
  const deducted =
    requestMismatch ||
    amounts.pending === null ||
    amounts.sending_after === null
      ? null
      : finite(amounts.pending + amounts.sending_after);
  const usable = valid && !bindingMismatch;
  const needed = usable
    ? finite(binding.quantity_per_serving * servings)
    : null;
  const adjusted =
    usable && raw !== null && deducted !== null ? finite(raw - deducted) : null;
  const shortfall =
    needed !== null && adjusted !== null
      ? finite(Math.max(needed - adjusted, 0))
      : null;
  const stale = snapshot.stale || fetch === null;
  const unknown = shortfall === null || timingUnknown || requestMismatch;
  const flags = {
    unavailable: !valid || snapshot.error !== null,
    unknown,
    stale,
    uncertain: uncertain || timingUnknown,
    short: shortfall !== null && shortfall > 0,
  };
  return {
    reasons: (Object.keys(flags) as (keyof typeof flags)[]).filter(
      (reason) => flags[reason],
    ),
    stock_unit_id: unit,
    binding_status: bindingStatus.parse(binding.status),
    raw,
    deducted,
    adjusted,
    needed,
    shortfall,
    fetch_started_at: snapshot.fetch_started_at,
    last_success_at: snapshot.last_success_at,
    stale,
    error: snapshot.error,
    uncertain: uncertain || timingUnknown,
    unknown,
    timing_unknown: timingUnknown,
    unit_mismatch: bindingMismatch || requestMismatch,
    state_amounts: amounts,
  };
}
