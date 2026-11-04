import type { Database } from "better-sqlite3";

export type SelectUnreconciledEmailParams = {
  after_id: number;
};

export type SelectUnreconciledEmailResult = {
  id: number;
  user_id: number;
};

export function selectUnreconciledEmail(
  db: Database,
  params: SelectUnreconciledEmailParams,
): SelectUnreconciledEmailResult | null {
  const sql = `
	SELECT id, user_id FROM inbound_emails
	WHERE parse_state IN ('parsed', 'no_model', 'failed') AND disposition IS NULL AND id > ?
	ORDER BY id LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.after_id]);

  return res ? mapArrayToSelectUnreconciledEmailResult(res) : null;
}

function mapArrayToSelectUnreconciledEmailResult(data: any) {
  const result: SelectUnreconciledEmailResult = {
    id: data[0],
    user_id: data[1],
  };
  return result;
}
