import type { Database } from "better-sqlite3";

export type ConsumeStateParams = {
  state_hash: string;
  user_id: number;
  now: string;
};

export type ConsumeStateResult = {
  verifier: string;
  generation: number;
};

export function consumeState(
  db: Database,
  params: ConsumeStateParams,
): ConsumeStateResult[] {
  const sql = `
	DELETE FROM oura_states
	WHERE state_hash = ? AND user_id = ? AND expires_at > ?
	RETURNING verifier, generation;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.state_hash, params.user_id, params.now]);

  return rows.map((data) => mapArrayToConsumeStateResult(data));
}

function mapArrayToConsumeStateResult(data: any) {
  const result: ConsumeStateResult = {
    verifier: data[0],
    generation: data[1],
  };
  return result;
}
