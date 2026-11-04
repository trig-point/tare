import type { Database } from "better-sqlite3";
import { writeTransaction } from "../db.ts";
import { saveConnection } from "../queries/oura/save-connection.ts";
import { selectConnection } from "../queries/oura/select-connection.ts";
import { updateConnection } from "../queries/oura/update-connection.ts";
import { decryptPair, encryptPair, type TokenPair } from "./encryption.ts";

export function storeOuraConnection(
  database: Database,
  owner: number,
  generation: number,
  grant: { pair: TokenPair; expiresAt: string; scope?: string },
  key: Buffer,
  now: Date,
): boolean {
  const scopes =
    grant.scope === undefined
      ? ["daily", "workout"]
      : [
          ...new Set(
            grant.scope
              .split(" ")
              .map((scope) => scope.trim())
              .filter(Boolean),
          ),
        ];
  const data = {
    ...encryptPair(grant.pair, owner, key),
    access_expires_at: grant.expiresAt,
    scopes: JSON.stringify(scopes),
    scope_source: grant.scope === undefined ? "requested" : "response",
    now: now.toISOString(),
  };
  return writeTransaction(database, () =>
    generation === 0
      ? saveConnection(database, { ...data, user_id: owner, generation }) !==
        null
      : updateConnection(database, data, { user_id: owner, generation }) !==
        null,
  );
}

export function readOuraConnection(
  database: Database,
  owner: number,
  key: Buffer | undefined,
  configured: boolean,
) {
  const row = selectConnection(database, { user_id: owner });
  const readable = row ? decryptPair(row, owner, key) !== null : false;
  return {
    configured: configured && key !== undefined,
    status: row?.status ?? null,
    credentials: row ? (readable ? "readable" : "unreadable") : null,
    reconnect_required:
      row !== null && (!readable || row.status === "reconnect_required"),
    scopes: row ? (JSON.parse(row.scopes) as string[]) : [],
    scope_source: row?.scope_source ?? null,
    access_expires_at: row?.access_expires_at ?? null,
    last_synced_at: row?.last_synced_at ?? null,
  };
}
