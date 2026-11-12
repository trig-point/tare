import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { loadConfig } from "../../src/config.ts";
import {
  createPantryStock,
  type PantryStock,
} from "../../src/pantry/requests.ts";
import {
  createPantryService,
  type PantryService,
} from "../../src/pantry/service.ts";
import { accessConfig, credentials } from "../auth-support.ts";
import { twoUsers } from "./two-users.ts";

export const grocy = {
  url: "http://grocy/api",
  apiKey: "invented-secret",
  username: credentials.username,
};
type Person = Awaited<ReturnType<typeof twoUsers>>["admin"];

export async function json(person: Person, path: string, body?: unknown) {
  const response = await person.request(path, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

/** Grocy stock: product 7 holds 10, 9 holds 3, 10 holds 5, and 8 is active but empty; every unit is 2. */
export async function pantryHarness(context: TestContext) {
  const wired: { pantry?: PantryService; stock?: PantryStock } = {};
  // The owner exists only after the app does, so both are wired in afterwards.
  const late = <Value extends object>(read: () => Value | undefined) =>
    new Proxy({} as Value, {
      get: (_target, key) => Reflect.get(read() as Value, key),
    });
  const egress = { ...grocy };
  const harness = await twoUsers(context, "access", {
    pantry: late(() => wired.pantry),
    stock: late(() => wired.stock),
    config: {
      ...loadConfig({ DATABASE_URL: ":memory:" }),
      ...accessConfig,
      grocy: egress,
    },
  });
  const { database, admin } = harness;
  const clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };
  let reads = 0;
  const product = (id: number) => ({
    id,
    name: `Synthetic item ${id}`,
    qu_id_stock: 2,
    enable_tare_weight_handling: 0 as const,
  });
  const ok = <Value>(value: Value) =>
    Promise.resolve({ status: "ok" as const, value });
  wired.pantry = createPantryService({
    database,
    config: grocy,
    ownerId: admin.user.id,
    clock: { now: () => clock.now() },
    client: {
      stock: () => {
        reads++;
        return ok(
          [
            [7, 10],
            [9, 3],
            [10, 5],
          ].map(([id, amount]) => ({
            product_id: id as number,
            amount: amount as number,
            best_before_date: null,
            product: product(id as number),
          })),
        );
      },
      catalog: () =>
        ok([7, 8, 9, 10].map((id) => ({ ...product(id), active: 1 as const }))),
      product: (_owner, id) =>
        ok({
          product: product(id),
          quantity_unit_stock: { id: 2, name: "can", name_plural: null },
        }),
      barcodes: () => ok([]),
      recipes: () => ok([]),
      recipePositions: () => ok([]),
      fulfillment: () => ok([]),
      units: () => ok([]),
      conversions: () => ok([]),
    },
  });
  wired.stock = createPantryStock({
    config: grocy,
    ownerId: admin.user.id,
    clock,
    report: assert.fail,
  });
  const bind = (kind: string, id: number, productId: number, unit = 2) =>
    database
      .prepare(
        "INSERT OR REPLACE INTO pantry_bindings VALUES (?, (SELECT generation FROM pantry_connection), ?, ?, ?, ?, 0.5, 'valid', ?)",
      )
      .run(admin.user.id, kind, id, productId, unit, randomUUID());
  const attempt = database.prepare(
    "INSERT INTO pantry_attempts VALUES (?, 1, ?, ?, NULL, NULL, ?, ?, ?)",
  );
  /** A product 7 request for the food; `at` is the send time, or the confirmation time when delivered. */
  const request = (
    foodId: number,
    state: string,
    quantity: number,
    at?: string,
  ) => {
    const id = randomUUID();
    database
      .prepare(
        "INSERT INTO pantry_requests (id, user_id, generation, client_id, reference_kind, reference_id, product_id, stock_unit_id, quantity_per_serving, quantity, state, attempt_count, claim_token, created_at) VALUES (?, ?, 1, ?, 'food', ?, 7, 2, 0.5, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z')",
      )
      .run(
        id,
        admin.user.id,
        id,
        foodId,
        quantity,
        state,
        at ? 1 : 0,
        state === "sending" ? id : null,
      );
    if (at && state === "sending")
      attempt.run(id, id, "sending", null, at, null);
    if (at && state === "delivered")
      attempt.run(id, id, "confirmed", "[]", at, at);
    return id;
  };
  return { ...harness, clock, egress, reads: () => reads, bind, request };
}
