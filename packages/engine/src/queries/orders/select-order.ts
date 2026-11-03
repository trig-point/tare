import type { Database } from "better-sqlite3";

export type SelectOrderParams = {
  user_id: number;
  id: number;
};

export type SelectOrderResult = {
  id: number;
  user_id: number;
  service: string;
  delivery_date: string;
  status: string;
  delivered_at: string | null;
  created_at: string;
};

export function selectOrder(
  db: Database,
  params: SelectOrderParams,
): SelectOrderResult | null {
  const sql = `
	SELECT * FROM orders WHERE user_id = ? AND id = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.id]);

  return res ? mapArrayToSelectOrderResult(res) : null;
}

function mapArrayToSelectOrderResult(data: any) {
  const result: SelectOrderResult = {
    id: data[0],
    user_id: data[1],
    service: data[2],
    delivery_date: data[3],
    status: data[4],
    delivered_at: data[5],
    created_at: data[6],
  };
  return result;
}
