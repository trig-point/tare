import type { Database } from "better-sqlite3";

export type SelectQueuedInboundEmailParams = {
  after_id: number;
};

export type SelectQueuedInboundEmailResult = {
  id: number;
  user_id: number;
  service: string | null;
  mark: string;
  dedupe_key: string;
  raw: Uint8Array;
  subject_attached: number;
  parse_state: string;
  parse_result: string | null;
  reason_class: string | null;
  created_at: string;
  updated_at: string;
  disposition: string | null;
  disposition_at: string | null;
  released_at: string | null;
  manual_result: string | null;
  applied_order_id: number | null;
  timezone: string;
  day_start_hour: number;
};

export function selectQueuedInboundEmail(
  db: Database,
  params: SelectQueuedInboundEmailParams,
): SelectQueuedInboundEmailResult | null {
  const sql = `
	SELECT inbound_emails.*, users.timezone, users.day_start_hour
	FROM inbound_emails JOIN users ON users.id = inbound_emails.user_id
	WHERE parse_state = 'queued' AND inbound_emails.id > ?
	ORDER BY inbound_emails.id LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.after_id]);

  return res ? mapArrayToSelectQueuedInboundEmailResult(res) : null;
}

function mapArrayToSelectQueuedInboundEmailResult(data: any) {
  const result: SelectQueuedInboundEmailResult = {
    id: data[0],
    user_id: data[1],
    service: data[2],
    mark: data[3],
    dedupe_key: data[4],
    raw: data[5],
    subject_attached: data[6],
    parse_state: data[7],
    parse_result: data[8],
    reason_class: data[9],
    created_at: data[10],
    updated_at: data[11],
    disposition: data[12],
    disposition_at: data[13],
    released_at: data[14],
    manual_result: data[15],
    applied_order_id: data[16],
    timezone: data[17],
    day_start_hour: data[18],
  };
  return result;
}
