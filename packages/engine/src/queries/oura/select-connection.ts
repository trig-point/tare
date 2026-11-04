import type { Database } from "better-sqlite3";

export type SelectConnectionParams = {
  user_id: number;
};

export type SelectConnectionResult = {
  user_id: number;
  version: number;
  ciphertext: string;
  iv: string;
  tag: string;
  access_expires_at: string;
  scopes: string;
  scope_source: string;
  status: string;
  generation: number;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export function selectConnection(
  db: Database,
  params: SelectConnectionParams,
): SelectConnectionResult | null {
  const sql = `
	SELECT * FROM oura_connections WHERE user_id = ?;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id]);

  return res ? mapArrayToSelectConnectionResult(res) : null;
}

function mapArrayToSelectConnectionResult(data: any) {
  const result: SelectConnectionResult = {
    user_id: data[0],
    version: data[1],
    ciphertext: data[2],
    iv: data[3],
    tag: data[4],
    access_expires_at: data[5],
    scopes: data[6],
    scope_source: data[7],
    status: data[8],
    generation: data[9],
    last_synced_at: data[10],
    created_at: data[11],
    updated_at: data[12],
  };
  return result;
}
