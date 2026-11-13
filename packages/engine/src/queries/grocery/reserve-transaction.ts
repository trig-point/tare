import type { Database } from "better-sqlite3";

export type ReserveTransactionParams = {
  transaction_id: string;
  request_id: number;
  step_number: number;
};

export type ReserveTransactionResult = {
  transaction_id: string;
};

export function reserveTransaction(
  db: Database,
  params: ReserveTransactionParams,
): ReserveTransactionResult | null {
  const sql = `
	INSERT INTO grocery_transactions (transaction_id, request_id, step_number) VALUES (?, ?, ?)
	ON CONFLICT (transaction_id) DO NOTHING RETURNING transaction_id;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.transaction_id, params.request_id, params.step_number]);

  return res ? mapArrayToReserveTransactionResult(res) : null;
}

function mapArrayToReserveTransactionResult(data: any) {
  const result: ReserveTransactionResult = {
    transaction_id: data[0],
  };
  return result;
}
