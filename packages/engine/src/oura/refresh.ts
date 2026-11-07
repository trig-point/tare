import type { Database } from "better-sqlite3";
import type { Config } from "../config.ts";
import { writeTransaction } from "../db.ts";
import { markReconnect } from "../queries/oura/mark-reconnect.ts";
import { refreshConnection } from "../queries/oura/refresh-connection.ts";
import { selectConnection } from "../queries/oura/select-connection.ts";
import { decryptPair, encryptPair } from "./encryption.ts";
import {
  type RefreshGrant,
  refreshGrant,
  type TokenTransport,
} from "./provider.ts";
import type { Attempt } from "./refresh-attempts.ts";
import type { Access, RefreshResult } from "./refresh-result.ts";

export async function refreshAccess(
  database: Database,
  owner: number,
  config: Config,
  clock: { now(): Date },
  attempt: Attempt,
  transport?: TokenTransport,
): Promise<RefreshResult> {
  const key = config.ouraTokenKey;
  if (!key) return "oura_key_unavailable";
  function read() {
    const row = selectConnection(database, { user_id: owner });
    if (!row) return "oura_not_connected";
    const pair = decryptPair(row, owner, key);
    if (!pair || row.status === "reconnect_required")
      return "oura_reconnect_required";
    return { row, pair };
  }
  function usable(access: Access): RefreshResult {
    return Date.parse(access.accessExpiresAt) > clock.now().getTime() + 30_000
      ? access
      : "oura_unavailable";
  }
  function winner(): RefreshResult {
    try {
      const current = read();
      return typeof current === "string"
        ? current
        : usable({
            accessToken: current.pair.access_token,
            accessExpiresAt: current.row.access_expires_at,
          });
    } catch {
      return "oura_unavailable";
    }
  }
  let stored: ReturnType<typeof read>;
  try {
    stored = read();
  } catch {
    return "oura_unavailable";
  }
  if (typeof stored === "string") return stored;
  const { row } = stored;
  const reused = usable({
    accessToken: stored.pair.access_token,
    accessExpiresAt: row.access_expires_at,
  });
  if (typeof reused !== "string") return reused;
  if (!config.oura) return "oura_not_configured";
  if (attempt.callers.size === 0) return "oura_unavailable";
  let saveStartedAt = 0;
  const grant = await refreshGrant(
    config.oura,
    stored.pair.refresh_token,
    clock.now(),
    AbortSignal.any([attempt.controller.signal, AbortSignal.timeout(15_000)]),
    () => {
      attempt.validated = true;
      saveStartedAt = clock.now().getTime();
    },
    transport,
  );
  if (typeof grant === "string") {
    if (grant !== "oura_reconnect_required") return grant;
    try {
      const marked = writeTransaction(database, () =>
        markReconnect(database, {
          user_id: owner,
          generation: row.generation,
        }),
      );
      return marked ? grant : winner();
    } catch {
      return "oura_reconnect_required";
    }
  }
  // A validated rotation must get its first save even after the last caller stops.
  return save(grant);

  async function save(grant: RefreshGrant): Promise<RefreshResult> {
    for (let retry = 0; retry <= 3; retry++) {
      if (retry > 0 && attempt.callers.size === 0) break;
      const remaining = Math.floor(
        saveStartedAt + 15_000 - clock.now().getTime(),
      );
      if (remaining <= 0) break;
      try {
        const previous = database.pragma("busy_timeout", {
          simple: true,
        }) as number;
        let saved: ReturnType<typeof refreshConnection>;
        try {
          database.pragma(`busy_timeout = ${Math.min(5000, remaining)}`);
          const scopes =
            grant.scope === undefined
              ? row.scopes
              : JSON.stringify([
                  ...new Set(
                    grant.scope
                      .split(" ")
                      .map((scope) => scope.trim())
                      .filter(Boolean),
                  ),
                ]);
          saved = writeTransaction(database, () =>
            refreshConnection(
              database,
              {
                ...encryptPair(
                  {
                    access_token: grant.access_token,
                    refresh_token: grant.refresh_token,
                  },
                  owner,
                  key as Buffer,
                ),
                access_expires_at: grant.expiresAt,
                scopes,
                scope_source:
                  grant.scope === undefined ? row.scope_source : "response",
                now: clock.now().toISOString(),
              },
              { user_id: owner, generation: row.generation },
            ),
          );
        } finally {
          database.pragma(`busy_timeout = ${previous}`);
        }
        if (!saved) return winner();
        return usable({
          accessToken: grant.access_token,
          accessExpiresAt: grant.expiresAt,
        });
      } catch {
        await Promise.resolve();
      }
    }
    return "oura_save_failed";
  }
}
