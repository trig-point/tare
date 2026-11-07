import type { Database } from "better-sqlite3";

export type RefreshConnectionData = {
  version: number;
  ciphertext: string;
  iv: string;
  tag: string;
  access_expires_at: string;
  scopes: string;
  scope_source: string;
  now: string;
};

export type RefreshConnectionParams = {
  user_id: number;
  generation: number;
};

export type RefreshConnectionResult = {
  generation: number;
};

export function refreshConnection(
  db: Database,
  data: RefreshConnectionData,
  params: RefreshConnectionParams,
): RefreshConnectionResult | null {
  const sql = `
	UPDATE oura_connections SET
	  version = ?, ciphertext = ?, iv = ?, tag = ?,
	  access_expires_at = ?, scopes = ?, scope_source = ?,
	  status = CASE WHEN status = 'membership_required' THEN status ELSE 'connected' END,
	  generation = generation + 1, updated_at = ?
	WHERE user_id = ? AND generation = ?
	RETURNING generation;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      data.version,
      data.ciphertext,
      data.iv,
      data.tag,
      data.access_expires_at,
      data.scopes,
      data.scope_source,
      data.now,
      params.user_id,
      params.generation,
    ]);

  return res ? mapArrayToRefreshConnectionResult(res) : null;
}

function mapArrayToRefreshConnectionResult(data: any) {
  const result: RefreshConnectionResult = {
    generation: data[0],
  };
  return result;
}
