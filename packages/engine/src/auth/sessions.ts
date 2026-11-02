import { createHash, randomBytes } from "node:crypto";
import type { Database } from "better-sqlite3";
import { deleteExpiredSessions } from "../queries/delete-expired-sessions.ts";
import { deleteSession } from "../queries/delete-session.ts";
import { insertSession } from "../queries/insert-session.ts";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(
  database: Database,
  userId: number,
  presentedToken: string | undefined,
  now: Date,
  sessionDays: number,
): string {
  const token = randomBytes(32).toString("base64url");
  database.transaction(() => {
    deleteExpiredSessions(database, { now: now.toISOString() });
    if (presentedToken !== undefined)
      deleteSession(database, { token_hash: hashToken(presentedToken) });
    insertSession(database, {
      token_hash: hashToken(token),
      user_id: userId,
      created_at: now.toISOString(),
      expires_at: new Date(
        now.getTime() + sessionDays * 86_400_000,
      ).toISOString(),
    });
  })();
  return token;
}
