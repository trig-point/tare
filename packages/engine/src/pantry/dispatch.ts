import type { Database } from "better-sqlite3";
import type { createGrocyClient } from "../grocy/client.ts";
import type { GrocyConfig } from "../grocy/config.ts";
import {
  type ListPendingRequestsResult,
  listPendingRequests,
} from "../queries/pantry/list-pending-requests.ts";
import { readConnection } from "../queries/pantry/read-connection.ts";
import {
  claimRequest,
  finalizeClaim,
  type PantryConnection,
  rejectRequest,
} from "./requests.ts";

type Client = Pick<
  ReturnType<typeof createGrocyClient>,
  "catalog" | "product" | "consume"
>;
export type DispatchReport =
  | "pantry_dispatch_failed"
  | "pantry_read_failed"
  | "pantry_consume_rejected"
  | "pantry_consume_unconfirmed"
  | "pantry_finalize_failed"
  | "pantry_refresh_failed";

/** Sends pending pantry requests to Grocy once each; unconfirmed sends are never repeated. */
export function createPantryDispatcher({
  database,
  config,
  ownerId,
  clock,
  client,
  refresh,
  report,
}: {
  database: Database;
  config: GrocyConfig;
  ownerId: number;
  clock: { now(): Date };
  client: Client;
  refresh(): Promise<{ error: unknown } | undefined>;
  report(code: DispatchReport): void;
}) {
  let stopping = false;
  let sweeping: Promise<boolean> | undefined;
  let again = false;
  const tracked = new Set<Promise<unknown>>();
  let failures = 0;
  // Failures that leave work undone; the scheduled job must not record them as ok.
  function fail(code: DispatchReport) {
    failures++;
    report(code);
  }

  function connection(): PantryConnection | null {
    const row = readConnection(database);
    if (
      !row ||
      row.reset_required ||
      row.user_id !== ownerId ||
      row.url !== config.url ||
      row.username !== config.username
    )
      return null;
    return {
      user_id: ownerId,
      generation: row.generation,
      url: config.url,
      username: config.username,
    };
  }

  // null leaves the request pending: only a successful read can prove it ineligible.
  async function eligibility(
    candidate: ListPendingRequestsResult,
    active: Set<number>,
  ) {
    if (!active.has(candidate.product_id)) return "product_missing" as const;
    const read = await client.product(ownerId, candidate.product_id);
    if (read?.status !== "ok")
      return read && "reason" in read && read.reason === "not_found"
        ? ("product_missing" as const)
        : null;
    const { product, quantity_unit_stock: unit } = read.value;
    if (product.id !== candidate.product_id || product.qu_id_stock !== unit.id)
      return null;
    if (product.enable_tare_weight_handling === 1)
      return "tare_enabled" as const;
    return unit.id === candidate.stock_unit_id
      ? ("valid" as const)
      : ("unit_mismatch" as const);
  }

  async function pass() {
    const identity = connection();
    if (!identity) return;
    const candidates = listPendingRequests(database, {
      user_id: identity.user_id,
      generation: identity.generation,
    });
    if (candidates.length === 0) return;
    const catalog = await client.catalog(ownerId);
    if (stopping) return;
    if (catalog?.status !== "ok") return fail("pantry_read_failed");
    const active = new Set(
      catalog.value
        .filter((product) => product.active === 1)
        .map((product) => product.id),
    );
    let unreadable = false;
    for (const candidate of candidates) {
      if (stopping) return;
      const status = await eligibility(candidate, active);
      if (stopping) return;
      if (status === null) {
        unreadable = true;
        continue;
      }
      if (status !== "valid") {
        rejectRequest(database, candidate, identity, status);
        continue;
      }
      const claim = claimRequest(database, candidate, identity, clock);
      if (!claim) continue;
      let result: Awaited<ReturnType<Client["consume"]>>;
      try {
        result = await client.consume(
          ownerId,
          claim.product_id,
          claim.quantity,
        );
      } catch {
        result = undefined;
      }
      let finalized: boolean;
      try {
        finalized = finalizeClaim(database, claim, result, clock);
      } catch {
        finalized = false;
      }
      // A failed write leaves the request sending; startup recovery marks it uncertain.
      if (!finalized) fail("pantry_finalize_failed");
      else if (result?.status === "rejected") report("pantry_consume_rejected");
      else if (result?.status !== "confirmed")
        report("pantry_consume_unconfirmed");
      else
        void refresh().then(
          (read) => read?.error && report("pantry_refresh_failed"),
          () => report("pantry_refresh_failed"),
        );
    }
    if (unreadable) fail("pantry_read_failed");
  }

  // Resolves true when a pass in this sweep failed.
  function sweep(): Promise<boolean> {
    if (stopping) return Promise.resolve(false);
    if (sweeping) {
      again = true;
      return sweeping;
    }
    const work = Promise.resolve().then(async () => {
      const before = failures;
      try {
        do {
          again = false;
          try {
            await pass();
          } catch {
            fail("pantry_dispatch_failed");
          }
        } while (again && !stopping);
        return failures !== before;
      } finally {
        sweeping = undefined;
      }
    });
    sweeping = work;
    tracked.add(work);
    const release = () => tracked.delete(work);
    work.then(release, release);
    return work;
  }

  return {
    kick() {
      void sweep();
    },
    stop() {
      stopping = true;
      return Promise.allSettled([...tracked]).then(() => {});
    },
    job: {
      name: "pantry-dispatch",
      schedule: "* * * * *",
      async run() {
        // Empty details cannot collide with a configured credential.
        if (await sweep()) throw new Error("");
        return "";
      },
    },
  };
}
