import type { Database } from "better-sqlite3";

export type MarkReconnectParams = {
  user_id: number;
  generation: number;
};

export type MarkReconnectResult = {
  generation: number;
};

export function markReconnect(
  db: Database,
  params: MarkReconnectParams,
): MarkReconnectResult | null {
  const sql = `
	UPDATE oura_connections SET status = 'reconnect_required'
	WHERE user_id = ? AND generation = ?
	RETURNING generation;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.generation]);

  return res ? mapArrayToMarkReconnectResult(res) : null;
}

function mapArrayToMarkReconnectResult(data: any) {
  const result: MarkReconnectResult = {
    generation: data[0],
  };
  return result;
}
