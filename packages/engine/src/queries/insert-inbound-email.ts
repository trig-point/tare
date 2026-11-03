import type { Database } from "better-sqlite3";

export type InsertInboundEmailParams = {
  user_id: number;
  service: string | null;
  mark: string;
  dedupe_key: string;
  raw: Uint8Array;
  subject_attached: number;
  parse_state: string;
  reason_class: string | null;
  now: string;
};

export type InsertInboundEmailResult = {
  id: number;
};

export function insertInboundEmail(
  db: Database,
  params: InsertInboundEmailParams,
): InsertInboundEmailResult | null {
  const sql = `
	INSERT INTO inbound_emails (user_id, service, mark, dedupe_key, raw, subject_attached, parse_state, reason_class, created_at, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING id;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.service,
      params.mark,
      params.dedupe_key,
      params.raw,
      params.subject_attached,
      params.parse_state,
      params.reason_class,
      params.now,
      params.now,
    ]);

  return res ? mapArrayToInsertInboundEmailResult(res) : null;
}

function mapArrayToInsertInboundEmailResult(data: any) {
  const result: InsertInboundEmailResult = {
    id: data[0],
  };
  return result;
}
