import type { Database } from "better-sqlite3";

export type SelectNextOrderParams = {
  user_id: number;
  service: string;
  received_on: string;
};

export type SelectNextOrderResult = {
  id: number;
  user_id: number;
  service: string;
  delivery_date: string;
  status: string;
  delivered_at: string | null;
  created_at: string;
  applied_email_id: number | null;
};

export function selectNextOrder(
  db: Database,
  params: SelectNextOrderParams,
): SelectNextOrderResult | null {
  const sql = `
	SELECT * FROM orders WHERE user_id = ? AND service = ?
	AND delivery_date > ? ORDER BY delivery_date, id LIMIT 1;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.service, params.received_on]);

  return res ? mapArrayToSelectNextOrderResult(res) : null;
}

function mapArrayToSelectNextOrderResult(data: any) {
  const result: SelectNextOrderResult = {
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
