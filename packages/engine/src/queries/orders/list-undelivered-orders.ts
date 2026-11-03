import type { Database } from "better-sqlite3";

export type ListUndeliveredOrdersResult = {
  id: number;
  user_id: number;
  service: string;
  delivery_date: string;
  status: string;
  delivered_at: string | null;
  created_at: string;
};

export function listUndeliveredOrders(
  db: Database,
): ListUndeliveredOrdersResult[] {
  const sql = `
	SELECT * FROM orders WHERE delivered_at IS NULL ORDER BY id;
	
	`;
  const rows = db.prepare(sql).raw(true).all();

  return rows.map((data) => mapArrayToListUndeliveredOrdersResult(data));
}

function mapArrayToListUndeliveredOrdersResult(data: any) {
  const result: ListUndeliveredOrdersResult = {
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
