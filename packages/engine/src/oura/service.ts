import type { Database } from "better-sqlite3";
import * as oauth from "oauth4webapi";
import { hashToken } from "../auth/sessions.ts";
import type { Config } from "../config.ts";
import { writeTransaction } from "../db.ts";
import { OperationError } from "../operations/registry.ts";
import { consumeState } from "../queries/oura/consume-state.ts";
import { deleteExpiredStates } from "../queries/oura/delete-expired-states.ts";
import { deleteOwnerStates } from "../queries/oura/delete-owner-states.ts";
import { insertState } from "../queries/oura/insert-state.ts";
import { selectConnection } from "../queries/oura/select-connection.ts";
import { storeOuraConnection } from "./connections.ts";
import {
  authorizationUrl,
  exchangeCode,
  type TokenTransport,
} from "./provider.ts";
import { refreshAccess } from "./refresh.ts";
import { createRefreshCallers } from "./refresh-attempts.ts";

export interface OuraOptions {
  database: Database;
  config: Config;
  clock: { now(): Date };
  transport?: TokenTransport;
}

export function createOura({
  database,
  config,
  clock,
  transport,
}: OuraOptions) {
  const controller = new AbortController();
  const pending = new Set<Promise<boolean>>();
  const refreshCallers = createRefreshCallers();
  function cleanup() {
    deleteExpiredStates(database, { now: clock.now().toISOString() });
  }
  async function complete(owner: number, callback: URL): Promise<boolean> {
    try {
      const states = callback.searchParams.getAll("state");
      const state = states[0];
      if (states.length !== 1 || !state || !/^[A-Za-z0-9_-]{43}$/.test(state))
        return false;
      const [consumed] = writeTransaction(database, () =>
        consumeState(database, {
          state_hash: hashToken(state),
          user_id: owner,
          now: clock.now().toISOString(),
        }),
      );
      if (!consumed || !config.oura || !config.ouraTokenKey) return false;
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(15_000),
      ]);
      signal.throwIfAborted();
      const tokens = await exchangeCode(
        config.oura,
        callback,
        state,
        consumed.verifier,
        signal,
        transport,
      );
      signal.throwIfAborted();
      const now = clock.now();
      return storeOuraConnection(
        database,
        owner,
        consumed.generation,
        {
          pair: {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
          },
          expiresAt: new Date(
            now.getTime() + tokens.expires_in * 1000,
          ).toISOString(),
          ...(tokens.scope === undefined ? {} : { scope: tokens.scope }),
        },
        config.ouraTokenKey,
        now,
      );
    } catch (error) {
      // Message and class only: the error's cause can carry code, state or tokens.
      if (error instanceof Error)
        console.error(
          "oura_callback_failed",
          error.constructor.name,
          error.message,
        );
      else console.error("oura_callback_failed", typeof error);
      return false;
    }
  }
  return {
    refreshAccess(owner: number) {
      return refreshCallers.refresh(database, owner, (attempt) =>
        refreshAccess(database, owner, config, clock, attempt, transport),
      );
    },
    async connect(owner: number) {
      if (!config.oura) throw new OperationError(503, "oura_not_configured");
      if (!config.ouraTokenKey)
        throw new OperationError(503, "oura_key_unavailable");
      if (controller.signal.aborted)
        throw new OperationError(503, "oura_unavailable");
      const state = oauth.generateRandomState();
      const verifier = oauth.generateRandomCodeVerifier();
      const url = await authorizationUrl(config.oura, state, verifier);
      if (controller.signal.aborted)
        throw new OperationError(503, "oura_unavailable");
      const now = clock.now();
      writeTransaction(database, () => {
        const generation =
          selectConnection(database, { user_id: owner })?.generation ?? 0;
        deleteOwnerStates(database, { user_id: owner });
        insertState(database, {
          state_hash: hashToken(state),
          user_id: owner,
          verifier,
          generation,
          created_at: now.toISOString(),
          expires_at: new Date(now.getTime() + 600_000).toISOString(),
        });
      });
      return url;
    },
    callback(owner: number, callback: URL) {
      const operation = complete(owner, callback);
      pending.add(operation);
      void operation.finally(() => pending.delete(operation));
      return operation;
    },
    cleanup,
    job: {
      name: "oura-state-cleanup",
      schedule: "*/10 * * * *",
      run() {
        cleanup();
        return "oura_states_cleaned";
      },
    },
    async stop() {
      controller.abort();
      const refreshing = refreshCallers.stop();
      await Promise.allSettled([...pending, refreshing]);
    },
  };
}
export type OuraService = ReturnType<typeof createOura>;
