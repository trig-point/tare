import type { Database } from "better-sqlite3";

export type InsertStateParams = {
  state_hash: string;
  user_id: number;
  verifier: string;
  generation: number;
  created_at: string;
  expires_at: string;
};

export type InsertStateResult = {
  changes: number;
  lastInsertRowid: number;
};

export function insertState(
  db: Database,
  params: InsertStateParams,
): InsertStateResult {
  const sql = `
	INSERT INTO oura_states (state_hash, user_id, verifier, generation, created_at, expires_at)
	VALUES (?, ?, ?, ?, ?, ?);
	
	`;
  return db
    .prepare(sql)
    .run([
      params.state_hash,
      params.user_id,
      params.verifier,
      params.generation,
      params.created_at,
      params.expires_at,
    ]) as InsertStateResult;
}
