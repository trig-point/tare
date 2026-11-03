import type { Database } from "better-sqlite3";

export type UpdateInboundParseData = {
  parse_state: string;
  parse_result: string | null;
  reason_class: string | null;
  now: string;
};

export type UpdateInboundParseParams = {
  id: number;
  user_id: number;
};

export type UpdateInboundParseResult = {
  changes: number;
};

export function updateInboundParse(
  db: Database,
  data: UpdateInboundParseData,
  params: UpdateInboundParseParams,
): UpdateInboundParseResult {
  const sql = `
	UPDATE inbound_emails
	SET parse_state = ?, parse_result = ?, reason_class = ?, updated_at = ?
	WHERE id = ? AND user_id = ? AND parse_state = 'queued';
	
	`;
  return db
    .prepare(sql)
    .run([
      data.parse_state,
      data.parse_result,
      data.reason_class,
      data.now,
      params.id,
      params.user_id,
    ]) as UpdateInboundParseResult;
}
