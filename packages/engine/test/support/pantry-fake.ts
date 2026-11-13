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

export async function json(
  person: Person,
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) {
  const response = await person.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

type GrocyRoute =
  | ((request: {
      path: string;
      id?: string;
      body: unknown;
      search: URLSearchParams;
    }) => unknown)
  | unknown;

/**
 * A fetch for createGrocyClient that answers each API path from `routes`, where numeric
 * segments match `:id`. A route may be a value, a Response or a function of the request.
 */
export function grocyFetch(routes: Record<string, GrocyRoute>) {
  const calls: string[] = [];
  let paused:
    | {
        matches: (path: string) => boolean;
        reached: () => void;
        release: Promise<void>;
      }
    | undefined;
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.replace(/^\/api/, "");
    calls.push(path);
    if (paused?.matches(path)) {
      const { reached, release } = paused;
      paused = undefined;
      reached();
      await release;
    }
    const pattern = path.replace(/\/\d+(?=\/|$)/g, "/:id");
    if (!(path in routes || pattern in routes))
      throw new Error(`Unexpected Grocy path ${path}`);
    const route = routes[path] ?? routes[pattern];
    const body =
      typeof route === "function"
        ? await route({
            path,
            id: path.match(/\/(\d+)(?=\/|$)/)?.[1],
            search: new URL(String(url)).searchParams,
            body: init?.body
              ? JSON.parse(await new Response(init.body).text())
              : undefined,
          })
        : route;
    return body instanceof Response ? body : Response.json(body);
  };
  /** Pauses the next request whose path equals or matches until `release` is called. */
  const hold = (path: string | RegExp) => {
    if (paused) throw new Error("A Grocy hold is already armed");
    const reached = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    paused = {
      matches: (candidate) =>
        typeof path === "string" ? candidate === path : path.test(candidate),
      reached: reached.resolve,
      release: released.promise,
    };
    return { reached: reached.promise, release: released.resolve };
  };
  return { fetch, calls, routes, hold };
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
  const kicks: number[] = [];
  wired.stock = createPantryStock({
    config: grocy,
    ownerId: admin.user.id,
    clock,
    kick: () => kicks.push(1),
    report: assert.fail,
  });
  const bind = (kind: string, id: number, productId: number, unit = 2) =>
    database
      .prepare(
        "INSERT OR REPLACE INTO pantry_bindings VALUES (?, (SELECT generation FROM pantry_connection), ?, ?, ?, ?, 0.5, 'valid', ?)",
      )
      .run(admin.user.id, kind, id, productId, unit, randomUUID());
  const attempt = database.prepare(
    "INSERT INTO pantry_attempts (request_id, number, kind, token, outcome, reason, http_status, receipt, started_at, finished_at) VALUES (?, 1, 'network', ?, ?, NULL, NULL, ?, ?, ?)",
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
  return {
    ...harness,
    clock,
    egress,
    kicks,
    reads: () => reads,
    bind,
    request,
  };
}
