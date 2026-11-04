import type { Database } from "better-sqlite3";

export type SaveConnectionParams = {
  user_id: number | null;
  version: number;
  ciphertext: string;
  iv: string;
  tag: string;
  access_expires_at: string;
  scopes: string;
  scope_source: string;
  now: string;
  generation: number;
};

export type SaveConnectionResult = {
  generation: number;
};

export function saveConnection(
  db: Database,
  params: SaveConnectionParams,
): SaveConnectionResult | null {
  const sql = `
	INSERT INTO oura_connections (
	  user_id, version, ciphertext, iv, tag, access_expires_at, scopes, scope_source,
	  status, generation, created_at, updated_at
	)
	SELECT ?, ?, ?, ?, ?, ?, ?, ?,
	  'connected', 1, ?, ?
	WHERE ? = 0
	ON CONFLICT(user_id) DO NOTHING
	RETURNING generation;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.version,
      params.ciphertext,
      params.iv,
      params.tag,
      params.access_expires_at,
      params.scopes,
      params.scope_source,
      params.now,
      params.now,
      params.generation,
    ]);

  return res ? mapArrayToSaveConnectionResult(res) : null;
}

function mapArrayToSaveConnectionResult(data: any) {
  const result: SaveConnectionResult = {
    generation: data[0],
  };
  return result;
}
