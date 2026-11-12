import { z } from "zod";
import type { GrocyConfig } from "./config.ts";

const decimal = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/)
      .transform(Number),
  ])
  .pipe(z.number().finite());
const identifier = decimal.pipe(z.number().int().positive());
export const grocyProductSchema = z.object({
  id: identifier,
  name: z.string().min(1),
  qu_id_stock: identifier,
  enable_tare_weight_handling: decimal.pipe(
    z.union([z.literal(0), z.literal(1)]),
  ),
});
export const grocyUnitSchema = z.object({
  id: identifier,
  name: z.string().min(1),
  name_plural: z.string().nullable(),
});
export const grocyStockSchema = z.array(
  z.object({
    product_id: identifier,
    amount: decimal,
    best_before_date: z.string().nullable(),
    product: grocyProductSchema,
  }),
);
export const grocyDetailsSchema = z.object({
  product: grocyProductSchema,
  quantity_unit_stock: grocyUnitSchema,
});
export const grocyBarcodesSchema = z.array(
  z.object({
    product_id: identifier,
    barcode: z.string().min(1),
    qu_id: identifier.nullable(),
    amount: decimal.nullable(),
  }),
);
export const grocyConversionsSchema = z.array(
  z.object({
    product_id: identifier.nullable(),
    from_qu_id: identifier,
    to_qu_id: identifier,
    factor: decimal.pipe(z.number().positive()),
  }),
);
export const grocyBookingsSchema = z
  .array(
    z.object({
      id: identifier,
      transaction_id: z.string().refine((value) => value.trim().length > 0),
      product_id: identifier,
      transaction_type: z.literal("consume"),
      amount: decimal.pipe(z.number().negative()),
    }),
  )
  .nonempty();
const grocyErrorSchema = z.object({ error_message: z.string().trim().min(1) });
// Grocy 4.7.1 StockService.php:367-370,419-423 throws these before writes.
// https://github.com/grocy/grocy/blob/v4.7.1/services/StockService.php#L365-L423
const refusedConsumeMessages = new Set([
  "Product does not exist or is inactive",
  "Amount to be consumed cannot be > current stock amount (if supplied, at the desired location)",
]);

type Reason =
  | "disabled"
  | "not_owner"
  | "invalid_input"
  | "unauthorized"
  | "not_found"
  | "http"
  | "invalid_response"
  | "transport"
  | "timeout"
  | "too_large";
export type GrocyFailure = {
  status: "failed" | "not_sent" | "rejected" | "uncertain";
  reason: Reason;
  httpStatus?: number;
};
export type GrocyResult<Value> =
  | { status: "ok" | "confirmed"; value: Value }
  | GrocyFailure;

export function createGrocyClient({
  config,
  ownerId,
  fetch: fetchRequest = globalThis.fetch,
}: {
  config: GrocyConfig | null;
  ownerId: number | null;
  fetch?: typeof globalThis.fetch;
}) {
  function failure(
    status: GrocyFailure["status"],
    reason: Reason,
    httpStatus?: number,
  ): GrocyFailure | undefined {
    const candidate: GrocyFailure = {
      status,
      reason,
      ...(httpStatus === undefined ? {} : { httpStatus }),
    };
    if (!config?.apiKey || !JSON.stringify(candidate).includes(config.apiKey))
      return candidate;
    const fallback: GrocyFailure = { status, reason: "transport" };
    return JSON.stringify(fallback).includes(config.apiKey)
      ? undefined
      : fallback;
  }

  async function request<Schema extends z.ZodType>(
    userId: number,
    path: string,
    schema: Schema,
    valid = true,
    amount?: number,
    consume = false,
  ): Promise<GrocyResult<z.output<Schema>> | undefined> {
    const before = consume ? "not_sent" : "failed";
    if (!config) return failure(before, "disabled");
    if (ownerId === null || userId !== ownerId)
      return failure(before, "not_owner");
    if (!valid) return failure(before, "invalid_input");
    const controller = new AbortController();
    let dispatched = false;
    let reason: Reason = "transport";
    const timer = setTimeout(() => {
      reason = "timeout";
      controller.abort();
    }, 30_000);
    try {
      const init: RequestInit & { duplex?: "half" } = {
        method: consume ? "POST" : "GET",
        headers: {
          "GROCY-API-KEY": config.apiKey,
          "Content-Type": "application/json",
        },
        redirect: "manual",
        signal: controller.signal,
        ...(consume
          ? {
              duplex: "half",
              // A stream prevents Node fetch from replaying consume after HTTP 421.
              body: new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      JSON.stringify({
                        amount,
                        transaction_type: "consume",
                        exact_amount: true,
                        allow_subproduct_substitution: false,
                      }),
                    ),
                  );
                  controller.close();
                },
              }),
            }
          : {}),
      };
      dispatched = true;
      const response = await fetchRequest(`${config.url}${path}`, init);
      const httpStatus = response.status;
      const httpReason =
        httpStatus === 401 || httpStatus === 403
          ? "unauthorized"
          : httpStatus === 404
            ? "not_found"
            : "http";
      const reader = response.body?.getReader();
      if (!reader)
        return failure(
          consume ? "uncertain" : "failed",
          response.ok ? "invalid_response" : httpReason,
          httpStatus,
        );
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 1_000_000) {
            reason = "too_large";
            controller.abort();
            await reader.cancel();
            return failure(
              consume ? "uncertain" : "failed",
              reason,
              httpStatus,
            );
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return failure(
          consume ? "uncertain" : "failed",
          response.ok ? "invalid_response" : httpReason,
          httpStatus,
        );
      }
      if (httpStatus < 200 || httpStatus >= 300) {
        const error = grocyErrorSchema.safeParse(body);
        const rejected =
          httpStatus === 400 &&
          error.success &&
          refusedConsumeMessages.has(error.data.error_message);
        return failure(
          consume ? (rejected ? "rejected" : "uncertain") : "failed",
          httpReason,
          httpStatus,
        );
      }
      const parsed = schema.safeParse(body);
      return parsed.success
        ? { status: consume ? "confirmed" : "ok", value: parsed.data }
        : failure(
            consume ? "uncertain" : "failed",
            "invalid_response",
            httpStatus,
          );
    } catch {
      controller.abort();
      return failure(
        consume ? (dispatched ? "uncertain" : "not_sent") : "failed",
        reason,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  const productIdValid = (productId: number) =>
    Number.isSafeInteger(productId) && productId > 0;
  return {
    stock: (userId: number) => request(userId, "/stock", grocyStockSchema),
    product: (userId: number, productId: number) =>
      request(
        userId,
        `/stock/products/${productId}`,
        grocyDetailsSchema,
        productIdValid(productId),
      ),
    barcode: (userId: number, barcode: string) => {
      let segment: string;
      try {
        segment = encodeURIComponent(barcode);
      } catch {
        return request(userId, "", grocyDetailsSchema, false);
      }
      return request(
        userId,
        `/stock/products/by-barcode/${segment}`,
        grocyDetailsSchema,
        typeof barcode === "string" &&
          barcode.length > 0 &&
          barcode !== "." &&
          barcode !== "..",
      );
    },
    barcodes: (userId: number) =>
      request(userId, "/objects/product_barcodes", grocyBarcodesSchema),
    units: (userId: number) =>
      request(userId, "/objects/quantity_units", z.array(grocyUnitSchema)),
    conversions: (userId: number) =>
      request(
        userId,
        "/objects/quantity_unit_conversions_resolved",
        grocyConversionsSchema,
      ),
    consume: (userId: number, productId: number, amount: number) =>
      request(
        userId,
        `/stock/products/${productId}/consume`,
        grocyBookingsSchema.refine((bookings) => {
          const consumed = -bookings.reduce(
            (total, booking) => total + booking.amount,
            0,
          );
          return (
            Number.isFinite(consumed) &&
            bookings.every((booking) => booking.product_id === productId) &&
            Math.abs(consumed - amount) <=
              Number.EPSILON * Math.max(consumed, amount) * bookings.length
          );
        }),
        productIdValid(productId) && Number.isFinite(amount) && amount > 0,
        amount,
        true,
      ),
  };
}
