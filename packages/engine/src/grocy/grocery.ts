import { z } from "zod";
import {
  createGrocyTransport,
  decimal,
  flag,
  type GrocyDependencies,
  type GrocyResult,
  identifier,
} from "./client.ts";

/** The only Grocy release whose provisioning wire behaviour has been smoke-tested. */
export const supportedGrocyVersion = "4.7.1";
export const neverExpires = { defaultDays: -1, bestBeforeDate: "2999-12-31" };

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const groceryUnitSchema = z.object({
  id: identifier,
  name: z.string(),
  name_plural: z.string().nullable(),
  active: flag,
});
export const groceryLocationSchema = z.object({
  id: identifier,
  name: z.string(),
  active: flag,
});
export const groceryProductSchema = z.object({
  id: identifier,
  name: z.string(),
  active: flag,
  location_id: identifier,
  qu_id_stock: identifier,
  qu_id_purchase: identifier,
  qu_id_consume: identifier,
  qu_id_price: identifier,
  default_best_before_days: decimal.pipe(z.number().int()),
  min_stock_amount: decimal,
  enable_tare_weight_handling: flag,
});
export const groceryBarcodeSchema = z.object({
  id: identifier,
  product_id: identifier,
  barcode: z.string(),
  qu_id: identifier.nullable(),
  amount: decimal.nullable(),
});
export const groceryStockLogSchema = z.object({
  id: identifier,
  product_id: identifier,
  amount: decimal,
  best_before_date: date.nullable(),
  purchased_date: date.nullable(),
  transaction_id: z.string().min(1),
  transaction_type: z.string(),
  location_id: identifier.nullable(),
  undone: flag,
});
export type GroceryProduct = z.output<typeof groceryProductSchema>;
export type GroceryStockLogRow = z.output<typeof groceryStockLogSchema>;

type Entity = "quantity_units" | "locations" | "products" | "product_barcodes";
const uniqueColumns: Record<Entity, string> = {
  quantity_units: "name",
  locations: "name",
  products: "name",
  product_barcodes: "barcode",
};

// Grocy matches filter values against an unanchored pattern and silently
// truncates at the first other character, so only fully matching text is sent.
const filterValue = /^[A-Za-z\p{L}\p{M}0-9*_.$#^| -\\]+$/u;
const findable = (value: unknown): value is string =>
  typeof value === "string" &&
  filterValue.test(value) &&
  value.trim() === value &&
  value.toLowerCase() !== "null" &&
  !/[<>]/.test(value);
const isId = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;
const isAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const isDate = (value: unknown) =>
  typeof value === "string" &&
  date.safeParse(value).success &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
const query = (filters: string[], order: string, limit: number) =>
  [
    ...filters.map((filter) => `query%5B%5D=${encodeURIComponent(filter)}`),
    `order=${encodeURIComponent(order)}`,
    `limit=${limit}`,
  ].join("&");

export type AddStock = {
  amount: number;
  best_before_date: string;
  purchased_date: string;
  location_id: number;
};
export type PurchaseReceipt = {
  transactionId: string;
  rows: GroceryStockLogRow[];
};

/** Every purchase row of one transaction, live, matching the confirmed add exactly. */
export function purchaseMatches(
  rows: GroceryStockLogRow[],
  productId: number,
  add: AddStock,
) {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return (
    rows.length > 0 &&
    rows.every(
      (row) =>
        row.transaction_id === rows[0]?.transaction_id &&
        row.product_id === productId &&
        row.transaction_type === "purchase" &&
        row.undone === 0 &&
        row.location_id === add.location_id &&
        row.best_before_date === add.best_before_date &&
        row.purchased_date === add.purchased_date,
    ) &&
    Math.abs(total - add.amount) <=
      Number.EPSILON * Math.max(total, add.amount) * rows.length
  );
}

/** Grocery provisioning calls; writes send once and never retry. */
export function createGroceryClient(dependencies: GrocyDependencies) {
  const request = createGrocyTransport(dependencies);
  const byId = <Schema extends z.ZodType>(
    userId: number,
    entity: Entity,
    schema: Schema,
    id: number,
  ) => request(userId, `/objects/${entity}/${id}`, schema, isId(id));
  const findUnique = <Schema extends z.ZodType>(
    userId: number,
    entity: Entity,
    schema: Schema,
    value: string,
  ) =>
    request(
      userId,
      `/objects/${entity}?${query([`${uniqueColumns[entity]}=${value}`], "id:asc", 2)}`,
      z
        .array(schema)
        .max(1)
        .refine((rows) =>
          rows.every(
            (row) =>
              (row as Record<string, unknown>)[uniqueColumns[entity]] === value,
          ),
        ),
      findable(value),
    );
  const create = (
    userId: number,
    entity: Entity,
    body: Record<string, unknown>,
    valid: boolean,
  ) =>
    request(
      userId,
      `/objects/${entity}`,
      z
        .object({ created_object_id: identifier })
        .transform((receipt) => receipt.created_object_id),
      valid,
      {
        body,
        refused: new Set([
          `SQLSTATE[23000]: Integrity constraint violation: 19 UNIQUE constraint failed: ${entity}.${uniqueColumns[entity]}`,
        ]),
      },
    );

  const version = (userId: number) =>
    request(
      userId,
      "/system/info",
      z
        .object({ grocy_version: z.object({ Version: z.string() }) })
        .transform((info) => info.grocy_version.Version),
    );

  return {
    version,
    /** Call before every write that could be sent; a mismatch is not_sent. */
    async requireSupportedVersion(
      userId: number,
    ): Promise<GrocyResult<string> | undefined> {
      const result = await version(userId);
      if (result?.status !== "ok" || result.value === supportedGrocyVersion)
        return result;
      return { status: "not_sent", reason: "unsupported_version" };
    },
    unit: (userId: number, id: number) =>
      byId(userId, "quantity_units", groceryUnitSchema, id),
    location: (userId: number, id: number) =>
      byId(userId, "locations", groceryLocationSchema, id),
    product: (userId: number, id: number) =>
      byId(userId, "products", groceryProductSchema, id),
    barcode: (userId: number, id: number) =>
      byId(userId, "product_barcodes", groceryBarcodeSchema, id),
    unitNamed: (userId: number, name: string) =>
      findUnique(userId, "quantity_units", groceryUnitSchema, name),
    locationNamed: (userId: number, name: string) =>
      findUnique(userId, "locations", groceryLocationSchema, name),
    productNamed: (userId: number, name: string) =>
      findUnique(userId, "products", groceryProductSchema, name),
    /** Exact raw text only; callers look up each padded form separately. */
    barcodeRows: (userId: number, barcode: string) =>
      findUnique(userId, "product_barcodes", groceryBarcodeSchema, barcode),
    /** Highest stock_log id for the product, or 0 when it has no rows. */
    stockLogMax: (userId: number, productId: number) =>
      request(
        userId,
        `/objects/stock_log?${query([`product_id=${productId}`], "id:desc", 1)}`,
        z
          .array(groceryStockLogSchema.pick({ id: true, product_id: true }))
          .max(1)
          .refine((rows) => rows.every((row) => row.product_id === productId))
          .transform((rows) => rows[0]?.id ?? 0),
        isId(productId),
      ),
    /** Purchase rows after a recorded maximum; complete is false when capped. */
    purchasesAfter: (
      userId: number,
      productId: number,
      afterId: number,
      limit: number,
    ) =>
      request(
        userId,
        `/objects/stock_log?${query(
          [
            `product_id=${productId}`,
            `id>${afterId}`,
            "transaction_type=purchase",
          ],
          "id:asc",
          limit + 1,
        )}`,
        z
          .array(groceryStockLogSchema)
          .max(limit + 1)
          .refine((rows) =>
            rows.every(
              (row, index) =>
                row.product_id === productId &&
                row.id > afterId &&
                row.transaction_type === "purchase" &&
                (index === 0 || row.id > (rows[index - 1]?.id ?? 0)),
            ),
          )
          .transform((rows) => ({
            rows: rows.slice(0, limit),
            complete: rows.length <= limit,
          })),
        isId(productId) &&
          Number.isSafeInteger(afterId) &&
          afterId >= 0 &&
          Number.isSafeInteger(limit) &&
          limit > 0 &&
          limit <= 100,
      ),
    /** All rows of one transaction, including undone ones. */
    transaction: (userId: number, transactionId: string) =>
      request(
        userId,
        `/stock/transactions/${encodeURIComponent(transactionId)}`,
        z
          .array(groceryStockLogSchema)
          .nonempty()
          .refine((rows) =>
            rows.every((row) => row.transaction_id === transactionId),
          ),
        typeof transactionId === "string" &&
          /^[A-Za-z0-9]{1,64}$/.test(transactionId),
      ),
    createUnit: (userId: number, unit: { name: string; name_plural: string }) =>
      create(
        userId,
        "quantity_units",
        { name: unit.name, name_plural: unit.name_plural },
        findable(unit.name) && findable(unit.name_plural),
      ),
    createLocation: (userId: number, location: { name: string }) =>
      create(
        userId,
        "locations",
        { name: location.name },
        findable(location.name),
      ),
    /** Purchase, consume and price units equal the stock unit; tare stays off. */
    createProduct: (
      userId: number,
      product: {
        name: string;
        location_id: number;
        qu_id_stock: number;
        default_best_before_days: number;
      },
    ) =>
      create(
        userId,
        "products",
        {
          name: product.name,
          location_id: product.location_id,
          qu_id_stock: product.qu_id_stock,
          qu_id_purchase: product.qu_id_stock,
          qu_id_consume: product.qu_id_stock,
          qu_id_price: product.qu_id_stock,
          default_best_before_days: product.default_best_before_days,
          min_stock_amount: 0,
          enable_tare_weight_handling: 0,
        },
        findable(product.name) &&
          isId(product.location_id) &&
          isId(product.qu_id_stock) &&
          Number.isSafeInteger(product.default_best_before_days) &&
          product.default_best_before_days >= -1,
      ),
    createBarcode: (
      userId: number,
      barcode: {
        product_id: number;
        barcode: string;
        qu_id: number;
        amount: number;
      },
    ) =>
      create(
        userId,
        "product_barcodes",
        {
          product_id: barcode.product_id,
          barcode: barcode.barcode,
          qu_id: barcode.qu_id,
          amount: barcode.amount,
        },
        findable(barcode.barcode) &&
          !/\s/.test(barcode.barcode) &&
          isId(barcode.product_id) &&
          isId(barcode.qu_id) &&
          isAmount(barcode.amount),
      ),
    /**
     * Adds the amount in the product's stock unit as given; Grocy converts
     * nothing with tare off. Grocy 4.7.1 does not check location_id when a
     * best_before_date is sent, so callers verify the location first.
     */
    addStock: (userId: number, productId: number, add: AddStock) =>
      request(
        userId,
        `/stock/products/${productId}/add`,
        z
          .array(groceryStockLogSchema)
          .refine((rows) => purchaseMatches(rows, productId, add))
          .transform(
            (rows): PurchaseReceipt => ({
              transactionId: rows[0]?.transaction_id ?? "",
              rows,
            }),
          ),
        isId(productId) &&
          isAmount(add.amount) &&
          isDate(add.best_before_date) &&
          isDate(add.purchased_date) &&
          isId(add.location_id),
        {
          body: {
            amount: add.amount,
            best_before_date: add.best_before_date,
            purchased_date: add.purchased_date,
            location_id: add.location_id,
            transaction_type: "purchase",
          },
          // Grocy 4.7.1 StockService.php:118 throws this before any write.
          refused: new Set(["Product does not exist or is inactive"]),
        },
      ),
  };
}
