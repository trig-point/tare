import type { Database } from "better-sqlite3";

export type SelectDeliveryOrderParams = {
  user_id: number;
  service: string;
  delivery_date: string;
};

export type SelectDeliveryOrderResult = {
  id: number;
  user_id: number;
  service: string;
  delivery_date: string;
  status: string;
  delivered_at: string | null;
  created_at: string;
  applied_email_id: number | null;
};

export function selectDeliveryOrder(
  db: Database,
  params: SelectDeliveryOrderParams,
): SelectDeliveryOrderResult | null {
  const sql = `
	SELECT * FROM orders WHERE user_id = ? AND service = ?
	AND delivery_date = ? LIMIT 1;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.service, params.delivery_date]);

  return res ? mapArrayToSelectDeliveryOrderResult(res) : null;
}

function mapArrayToSelectDeliveryOrderResult(data: any) {
  const result: SelectDeliveryOrderResult = {
    id: data[0],
    user_id: data[1],
    service: data[2],
    delivery_date: data[3],
    status: data[4],
    delivered_at: data[5],
    created_at: data[6],
    applied_email_id: data[7],
  };
  return result;
}
