import type { Database } from "better-sqlite3";

export type InsertAgentOrderParams = {
  user_id: number;
  service: string | null;
  dedupe_key: string;
  raw: Uint8Array;
  manual_result: string | null;
  now: string;
};

export type InsertAgentOrderResult = {
  id: number;
};

export function insertAgentOrder(
  db: Database,
  params: InsertAgentOrderParams,
): InsertAgentOrderResult | null {
  const sql = `
	INSERT INTO inbound_emails (user_id, service, mark, dedupe_key, raw, subject_attached, parse_state, manual_result, origin, created_at, updated_at)
	VALUES (?, ?, 'verified', ?, ?, 0, 'no_model', ?, 'agent', ?, ?)
	ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING id;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.service,
      params.dedupe_key,
      params.raw,
      params.manual_result,
      params.now,
      params.now,
    ]);

  return res ? mapArrayToInsertAgentOrderResult(res) : null;
}

function mapArrayToInsertAgentOrderResult(data: any) {
  const result: InsertAgentOrderResult = {
    id: data[0],
  };
  return result;
}
