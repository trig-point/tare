import type { Database } from "better-sqlite3";

export type InsertOrderParams = {
  user_id: number;
  service: string;
  delivery_date: string;
  status: string;
  created_at: string;
};

export type InsertOrderResult = {
  id: number;
  user_id: number;
  service: string;
  delivery_date: string;
  status: string;
  delivered_at: string | null;
  created_at: string;
  applied_email_id: number | null;
};

export function insertOrder(
  db: Database,
  params: InsertOrderParams,
): InsertOrderResult | null {
  const sql = `
	INSERT INTO orders (user_id, service, delivery_date, status, created_at)
	VALUES (?, ?, ?, ?, ?) RETURNING *;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.service,
      params.delivery_date,
      params.status,
      params.created_at,
    ]);

  return res ? mapArrayToInsertOrderResult(res) : null;
}

function mapArrayToInsertOrderResult(data: any) {
  const result: InsertOrderResult = {
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
