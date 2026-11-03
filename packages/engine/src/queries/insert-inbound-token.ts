import type { Database } from "better-sqlite3";

export type InsertInboundTokenParams = {
  user_id: number | null;
  token_hash: string;
  created_at: string;
};

export type InsertInboundTokenResult = {
  user_id: number;
};

export function insertInboundToken(
  db: Database,
  params: InsertInboundTokenParams,
): InsertInboundTokenResult | null {
  const sql = `
	INSERT INTO inbound_tokens (user_id, token_hash, created_at)
	VALUES (?, ?, ?)
	ON CONFLICT (user_id) DO NOTHING RETURNING user_id;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.token_hash, params.created_at]);

  return res ? mapArrayToInsertInboundTokenResult(res) : null;
}

function mapArrayToInsertInboundTokenResult(data: any) {
  const result: InsertInboundTokenResult = {
    user_id: data[0],
  };
  return result;
}
