import type { Database } from "better-sqlite3";

export type UpdateConnectionData = {
  version: number;
  ciphertext: string;
  iv: string;
  tag: string;
  access_expires_at: string;
  scopes: string;
  scope_source: string;
  now: string;
};

export type UpdateConnectionParams = {
  user_id: number;
  generation: number;
};

export type UpdateConnectionResult = {
  generation: number;
};

export function updateConnection(
  db: Database,
  data: UpdateConnectionData,
  params: UpdateConnectionParams,
): UpdateConnectionResult | null {
  const sql = `
	UPDATE oura_connections SET
	  version = ?, ciphertext = ?, iv = ?, tag = ?,
	  access_expires_at = ?, scopes = ?, scope_source = ?,
	  status = 'connected', generation = generation + 1, updated_at = ?
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

  return res ? mapArrayToUpdateConnectionResult(res) : null;
}

function mapArrayToUpdateConnectionResult(data: any) {
  const result: UpdateConnectionResult = {
    generation: data[0],
  };
  return result;
}
