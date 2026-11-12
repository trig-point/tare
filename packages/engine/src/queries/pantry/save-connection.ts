import type { Database } from "better-sqlite3";

export type SaveConnectionParams = {
  generation: number;
  url: string;
  username: string;
  user_id: number;
  reset_required: number;
  fetch_started_at: string | null;
  last_success_at: string | null;
  error: string | null;
};

export type SaveConnectionResult = {
  changes: number;
  lastInsertRowid: number;
};

export function saveConnection(
  db: Database,
  params: SaveConnectionParams,
): SaveConnectionResult {
  const sql = `
	INSERT INTO pantry_connection (id, generation, url, username, user_id, reset_required, fetch_started_at, last_success_at, error)
	VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET generation = excluded.generation, url = excluded.url, username = excluded.username, user_id = excluded.user_id, reset_required = excluded.reset_required, fetch_started_at = excluded.fetch_started_at, last_success_at = excluded.last_success_at, error = excluded.error;
	
	`;
  return db
    .prepare(sql)
    .run([
      params.generation,
      params.url,
      params.username,
      params.user_id,
      params.reset_required,
      params.fetch_started_at,
      params.last_success_at,
      params.error,
    ]) as SaveConnectionResult;
}
