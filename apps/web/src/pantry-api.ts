import { z } from "zod";
import { ApiError, api } from "./api.ts";

const unit = z.object({
  id: z.number(),
  name: z.string(),
  name_plural: z.string().nullable(),
});
export const pantrySchema = z.object({
  state: z.enum(["disabled", "reset_required", "never_refreshed", "ready"]),
  generation: z.number().nullable(),
  last_success_at: z.string().nullable(),
  stale: z.boolean(),
  error: z.object({ reason: z.string() }).nullable(),
  products: z.array(
    z.object({
      product_id: z.number(),
      name: z.string(),
      amount: z.number(),
      stock_unit: unit,
    }),
  ),
  bindings: z.array(
    z.object({
      reference_kind: z.enum(["food", "source_food"]),
      reference_id: z.number(),
      product_id: z.number(),
      quantity_per_serving: z.number(),
      status: z.string(),
    }),
  ),
  requested: z.array(
    z.object({
      product_id: z.number(),
      stock_unit_id: z.number(),
      pending: z.number(),
      sending: z.number(),
      uncertain: z.number(),
    }),
  ),
});
export type Pantry = z.infer<typeof pantrySchema>;

const stockRequest = z.object({
  request_id: z.string(),
  state: z.enum([
    "pending",
    "sending",
    "uncertain",
    "rejected",
    "delivered",
    "cancelled",
    "abandoned",
  ]),
  current_number: z.number(),
  created_at: z.string(),
  resolved_at: z.string().nullable(),
  frozen: z.object({ product_id: z.number(), quantity: z.number() }),
  reference: z.object({ kind: z.string(), id: z.number() }),
  intake: z.object({ name: z.string().nullable() }).nullable(),
  edit_notice: z.object({ servings: z.number() }).nullable(),
  retry: z.object({
    eligible: z.boolean(),
    not_before: z.string().nullable(),
  }),
});
export type StockRequest = z.infer<typeof stockRequest>;
const requestsSchema = z.object({
  state: z.enum(["disabled", "ready", "reset_required"]),
  unresolved: z.array(stockRequest),
  history: z.array(stockRequest),
});
export type StockRequests = z.infer<typeof requestsSchema>;
export type Decision = "delivered" | "not_delivered_retry" | "abandoned";

export const pantryKey = (person: number) => ["pantry", person] as const;
export const requestsKey = (person: number) =>
  ["pantry_requests", person] as const;
export const linkKey = (person: number) => ["pantry_link", person] as const;

export const readPantry = async (signal?: AbortSignal) =>
  pantrySchema.parse(await api("/api/pantry", { signal }));
export const readRequests = async (signal?: AbortSignal) =>
  requestsSchema.parse(await api("/api/pantry/requests", { signal }));
export const readLink = async (signal?: AbortSignal) =>
  z
    .object({ url: z.string().nullable() })
    .parse(await api("/api/pantry/link", { signal })).url;

const post = async (path: string, body: unknown) =>
  pantrySchema.parse(
    await api(path, { method: "POST", body: JSON.stringify(body) }),
  );
export const refreshPantry = () => post("/api/pantry/refresh", {});
export const resetPantry = () => post("/api/pantry/connection/reset", {});
export const saveBinding = (input: {
  reference_kind: "food" | "source_food";
  reference_id: number;
  product_id: number;
  stock_unit_id: number;
  quantity_per_serving: number;
  expected_generation: number;
}) => post("/api/pantry/bindings", input);
export const deleteBinding = async (kind: string, id: number) =>
  pantrySchema.parse(
    await api(`/api/pantry/bindings/${kind}/${id}`, { method: "DELETE" }),
  );

/** The caller keeps `mutation_id` for one chosen decision so a lost response can be resent safely. */
export const reconcile = async (input: {
  request_id: string;
  attempt_number: number;
  mutation_id: string;
  decision: Decision;
}) =>
  z.object({ resulting_state: z.string() }).parse(
    await api("/api/pantry/requests/reconcile", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );

const messages: Record<string, string> = {
  pantry_retry_too_early: "Too early to retry",
  pantry_stale_attempt: "Request changed",
  pantry_request_not_actionable: "Request changed",
  pantry_request_in_flight: "Request is sending",
  pantry_connection_changed: "Connection changed",
  mutation_conflict: "Request changed",
  pantry_reset_required: "Reset the connection first",
  pantry_requests_unresolved: "Resolve open requests first",
  pantry_generation_changed: "Pantry changed. Try again",
  pantry_binding_conflict: "Remove the current binding first",
  pantry_product_missing: "Product not found",
  pantry_unit_changed: "Product unit changed",
  pantry_tare_weight: "Tare-weight products can’t be bound",
  food_not_found: "Food not found",
  pantry_disabled: "Pantry not set up",
};
export const failureText = (error: unknown) =>
  (error instanceof ApiError && error.code && messages[error.code]) ||
  "Couldn’t save";
