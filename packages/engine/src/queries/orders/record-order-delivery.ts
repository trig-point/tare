import type { Database } from "better-sqlite3";

export type RecordOrderDeliveryData = {
  delivered_at: string | null;
};

export type RecordOrderDeliveryParams = {
  user_id: number;
  id: number;
};

export type RecordOrderDeliveryResult = {
  id: number;
};

export function recordOrderDelivery(
  db: Database,
  data: RecordOrderDeliveryData,
  params: RecordOrderDeliveryParams,
): RecordOrderDeliveryResult[] {
  const sql = `
	UPDATE orders SET delivered_at = ?
	WHERE user_id = ? AND id = ? AND delivered_at IS NULL RETURNING id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([data.delivered_at, params.user_id, params.id]);

  return rows.map((data) => mapArrayToRecordOrderDeliveryResult(data));
}

function mapArrayToRecordOrderDeliveryResult(data: any) {
  const result: RecordOrderDeliveryResult = {
    id: data[0],
  };
  return result;
}
