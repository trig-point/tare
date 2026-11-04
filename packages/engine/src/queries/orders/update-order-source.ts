import type { Database } from "better-sqlite3";

export type UpdateOrderSourceData = {
  status: string;
  applied_email_id: number | null;
};

export type UpdateOrderSourceParams = {
  user_id: number;
  id: number;
};

export type UpdateOrderSourceResult = {
  changes: number;
};

export function updateOrderSource(
  db: Database,
  data: UpdateOrderSourceData,
  params: UpdateOrderSourceParams,
): UpdateOrderSourceResult {
  const sql = `
	UPDATE orders SET status = ?, applied_email_id = ?
	WHERE user_id = ? AND id = ?;
	
	`;
  return db
    .prepare(sql)
    .run([
      data.status,
      data.applied_email_id,
      params.user_id,
      params.id,
    ]) as UpdateOrderSourceResult;
}
