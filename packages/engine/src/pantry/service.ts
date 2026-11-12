import type { Database } from "better-sqlite3";
import { z } from "zod";
import { scopeDatabase, writeTransaction } from "../db.ts";
import {
  createGrocyClient,
  type GrocyResult,
  grocyDetailsSchema,
  grocyStockSchema,
} from "../grocy/client.ts";
import type { GrocyConfig } from "../grocy/config.ts";
import { OperationError } from "../operations/registry.ts";
import { clearProducts } from "../queries/pantry/clear-products.ts";
import { insertProduct } from "../queries/pantry/insert-product.ts";
import { listProducts } from "../queries/pantry/list-products.ts";
import { readConnection } from "../queries/pantry/read-connection.ts";
import { saveConnection } from "../queries/pantry/save-connection.ts";

const identifier = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const pantryProduct = z.strictObject({
  product_id: identifier,
  name: z.string().min(1),
  amount: z.number().finite(),
  stock_unit: z.strictObject({
    id: identifier,
    name: z.string().min(1),
    name_plural: z.string().nullable(),
  }),
  best_before_date: z.string().nullable(),
  grams: z.null(),
});
const pantryError = z.strictObject({
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
export const pantryOutput = z.strictObject({
  state: z.enum(["disabled", "reset_required", "never_refreshed", "ready"]),
  generation: z.number().nullable(),
  fetch_started_at: z.string().nullable(),
  last_success_at: z.string().nullable(),
  stale: z.boolean(),
  error: pantryError.nullable(),
  products: z.array(pantryProduct),
});
type Product = z.infer<typeof pantryProduct>;
type PantryError = z.infer<typeof pantryError>;
export type PantryService = ReturnType<typeof createPantryService>;

export function createPantryService({
  database,
  config,
  ownerId,
  clock,
  client = createGrocyClient({ config, ownerId }),
}: {
  database: Database;
  config: GrocyConfig | null;
  ownerId: number | null;
  clock: { now(): Date };
  client?: Pick<ReturnType<typeof createGrocyClient>, "stock" | "product">;
}) {
  let stopping = false;
  let slot: { generation: number; work: Promise<void> } | undefined;
  const matches = (row: NonNullable<ReturnType<typeof readConnection>>) =>
    row.url === config?.url &&
    row.username === config.username &&
    row.user_id === ownerId;
  const initial = (generation: number) => {
    if (!config || ownerId === null) throw new Error("Pantry owner missing");
    return {
      generation,
      url: config.url,
      username: config.username,
      user_id: ownerId,
      reset_required: 0,
      fetch_started_at: null,
      last_success_at: null,
      error: null,
    };
  };
  if (config)
    writeTransaction(database, (scope) => {
      const database = scopeDatabase(scope);
      const row = readConnection(database);
      if (!row) saveConnection(database, initial(1));
      else if (!matches(row))
        saveConnection(database, { ...row, reset_required: 1 });
    });
  function authorize(userId: number) {
    if (config && userId !== ownerId)
      throw new OperationError(403, "forbidden");
    if (stopping) throw new OperationError(503, "pantry_stopping");
  }
  function read(userId: number) {
    authorize(userId);
    const empty = {
      generation: null,
      fetch_started_at: null,
      last_success_at: null,
      stale: true,
      error: null,
      products: [],
    };
    if (!config) return pantryOutput.parse({ ...empty, state: "disabled" });
    const row = readConnection(database);
    if (!row) throw new Error("Pantry connection missing");
    if (row.reset_required)
      return pantryOutput.parse({
        ...empty,
        state: "reset_required",
        generation: row.generation,
      });
    return pantryOutput.parse({
      state: row.last_success_at === null ? "never_refreshed" : "ready",
      generation: row.generation,
      fetch_started_at: row.fetch_started_at,
      last_success_at: row.last_success_at,
      stale:
        row.fetch_started_at === null ||
        clock.now().getTime() - Date.parse(row.fetch_started_at) > 600_000,
      error: row.error === null ? null : JSON.parse(row.error),
      products: listProducts(database, {
        user_id: userId,
        generation: row.generation,
      }).map((row) => JSON.parse(row.product)),
    });
  }
  function current(generation: number) {
    if (stopping) return false;
    const row = readConnection(database);
    return (
      !!row &&
      !row.reset_required &&
      row.generation === generation &&
      matches(row)
    );
  }
  async function attempt(generation: number) {
    const started = clock.now().toISOString();
    const products: Product[] = [];
    let error: PantryError | null = null;
    function unwrap<Value>(result: GrocyResult<Value> | undefined): Value {
      if (!result || result.status !== "ok") {
        error = pantryError.parse({
          reason:
            result && "reason" in result ? result.reason : "response_withheld",
          ...(!result ||
          !("httpStatus" in result) ||
          result.httpStatus === undefined
            ? {}
            : { http_status: result.httpStatus }),
        });
        throw new Error("Pantry read failed");
      }
      return result.value as Value;
    }
    try {
      if (!current(generation)) return;
      const stock = grocyStockSchema.parse(
        unwrap(await client.stock(ownerId as number)),
      );
      const seen = new Set<number>();
      const units = new Map<number, string>();
      for (const item of stock) {
        if (!current(generation)) return;
        identifier.parse(item.product_id);
        identifier.parse(item.product.qu_id_stock);
        if (seen.has(item.product_id) || item.product.id !== item.product_id)
          throw new Error("Invalid stock");
        seen.add(item.product_id);
        const detail = grocyDetailsSchema.parse(
          unwrap(await client.product(ownerId as number, item.product_id)),
        );
        const unit = detail.quantity_unit_stock;
        if (
          detail.product.id !== item.product_id ||
          detail.product.qu_id_stock !== unit.id ||
          item.product.qu_id_stock !== unit.id
        )
          throw new Error("Invalid unit");
        const metadata = JSON.stringify(unit);
        if (units.has(unit.id) && units.get(unit.id) !== metadata)
          throw new Error("Inconsistent unit");
        units.set(unit.id, metadata);
        products.push(
          pantryProduct.parse({
            product_id: item.product_id,
            name: detail.product.name,
            amount: item.amount,
            stock_unit: unit,
            best_before_date: item.best_before_date,
            grams: null,
          }),
        );
      }
    } catch {
      error ??= { reason: "invalid_response" };
    }
    writeTransaction(database, (scope) => {
      if (!current(generation)) return;
      const database = scopeDatabase(scope);
      const row = readConnection(database);
      if (!row) throw new Error("Pantry connection missing");
      if (error)
        saveConnection(database, { ...row, error: JSON.stringify(error) });
      else {
        clearProducts(database);
        for (const product of products)
          insertProduct(database, {
            user_id: row.user_id,
            generation,
            product_id: product.product_id,
            product: JSON.stringify(product),
          });
        saveConnection(database, {
          ...row,
          fetch_started_at: started,
          last_success_at: clock.now().toISOString(),
          error: null,
        });
      }
    });
  }
  async function refresh(userId: number) {
    authorize(userId);
    if (!config) return read(userId);
    const admitted = readConnection(database);
    if (!admitted) throw new Error("Pantry connection missing");
    if (admitted.reset_required) return read(userId);
    while (slot && slot.generation !== admitted.generation) {
      await slot.work;
      authorize(userId);
      if (!current(admitted.generation)) return read(userId);
    }
    if (!slot && current(admitted.generation)) {
      const work = Promise.resolve().then(() => attempt(admitted.generation));
      const occupied = { generation: admitted.generation, work };
      slot = occupied;
      const release = () => {
        if (slot === occupied) slot = undefined;
      };
      work.then(release, release);
    }
    await slot?.work;
    return read(userId);
  }
  return {
    read,
    refresh,
    reset(userId: number, replaced = false) {
      authorize(userId);
      if (!config) return read(userId);
      writeTransaction(database, (scope) => {
        const database = scopeDatabase(scope);
        const row = readConnection(database);
        if (!row) throw new Error("Pantry connection missing");
        if (!replaced && !row.reset_required && matches(row)) return;
        // Future consumption guards and cancellation belong in this transaction.
        clearProducts(database);
        saveConnection(database, initial(row.generation + 1));
      });
      return read(userId);
    },
    stop() {
      stopping = true;
      return slot?.work ?? Promise.resolve();
    },
    job: {
      name: "pantry-refresh",
      schedule: "*/5 * * * *",
      async run() {
        await refresh(ownerId ?? 0);
        // Empty job details cannot collide with a configured credential.
        return "";
      },
    },
  };
}
