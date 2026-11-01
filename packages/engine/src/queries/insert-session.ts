import type { Database } from "better-sqlite3";

export type InsertSessionParams = {
  token_hash: string;
  user_id: number;
  created_at: string;
  expires_at: string;
};

export type InsertSessionResult = {
  changes: number;
  lastInsertRowid: number;
};

export function insertSession(
  db: Database,
  params: InsertSessionParams,
): InsertSessionResult {
  const sql = `
	INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
	VALUES (?, ?, ?, ?);
	
	`;
  return db
    .prepare(sql)
    .run([
      params.token_hash,
      params.user_id,
      params.created_at,
      params.expires_at,
    ]) as InsertSessionResult;
}
