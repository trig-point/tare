import type { Database } from "better-sqlite3";

export type UpdateEmailReconciliationData = {
  disposition: string | null;
  now: string | null;
  manual_result: string | null;
  applied_order_id: number | null;
};

export type UpdateEmailReconciliationParams = {
  user_id: number;
  id: number;
};

export type UpdateEmailReconciliationResult = {
  changes: number;
};

export function updateEmailReconciliation(
  db: Database,
  data: UpdateEmailReconciliationData,
  params: UpdateEmailReconciliationParams,
): UpdateEmailReconciliationResult {
  const sql = `
	UPDATE inbound_emails SET disposition = ?, disposition_at = ?,
	manual_result = ?, applied_order_id = ?, updated_at = ?
	WHERE user_id = ? AND id = ?;
	
	`;
  return db
    .prepare(sql)
    .run([
      data.disposition,
      data.now,
      data.manual_result,
      data.applied_order_id,
      data.now,
      params.user_id,
      params.id,
    ]) as UpdateEmailReconciliationResult;
}
