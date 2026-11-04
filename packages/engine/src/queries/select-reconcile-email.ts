import type { Database } from "better-sqlite3";

export type SelectReconcileEmailParams = {
  user_id: number;
  id: number;
};

export type SelectReconcileEmailResult = {
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
};

export function selectReconcileEmail(
  db: Database,
  params: SelectReconcileEmailParams,
): SelectReconcileEmailResult | null {
  const sql = `
	SELECT * FROM inbound_emails WHERE user_id = ? AND id = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.id]);

  return res ? mapArrayToSelectReconcileEmailResult(res) : null;
}

function mapArrayToSelectReconcileEmailResult(data: any) {
  const result: SelectReconcileEmailResult = {
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
  };
  return result;
}
