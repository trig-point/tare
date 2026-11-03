import type { Database } from "better-sqlite3";

export type SelectInboundEmailParams = {
  user_id: number;
  dedupe_key: string;
};

export type SelectInboundEmailResult = {
  id: number;
};

export function selectInboundEmail(
  db: Database,
  params: SelectInboundEmailParams,
): SelectInboundEmailResult | null {
  const sql = `
	SELECT id FROM inbound_emails WHERE user_id = ? AND dedupe_key = ? LIMIT 1;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.dedupe_key]);

  return res ? mapArrayToSelectInboundEmailResult(res) : null;
}

function mapArrayToSelectInboundEmailResult(data: any) {
  const result: SelectInboundEmailResult = {
    id: data[0],
  };
  return result;
}
