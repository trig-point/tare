import type { Database } from "better-sqlite3";

export type AdoptStepData = {
  object_id: number | null;
  transaction_id: string | null;
  product_id: number | null;
  now: string;
};

export type AdoptStepParams = {
  request_id: number;
  number: number;
  transaction_id: string | null;
  product_id: number | null;
  object_id: number | null;
};

export type AdoptStepResult = {
  kind: string;
};

export function adoptStep(
  db: Database,
  data: AdoptStepData,
  params: AdoptStepParams,
): AdoptStepResult[] {
  const sql = `
	UPDATE grocery_steps SET state = 'adopted', object_id = ?, transaction_id = ?, product_id = coalesce(product_id, ?), updated_at = ?
	WHERE request_id = ? AND number = ? AND state = 'uncertain'
	  AND ((kind = 'stock_add' AND ? IS NOT NULL AND ? IS NOT NULL AND (product_id IS NULL OR product_id = ?))
	    OR (kind != 'stock_add' AND ? IS NOT NULL))
	RETURNING kind;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      data.object_id,
      data.transaction_id,
      data.product_id,
      data.now,
      params.request_id,
      params.number,
      params.transaction_id,
      params.product_id,
      params.product_id,
      params.object_id,
    ]);

  return rows.map((data) => mapArrayToAdoptStepResult(data));
}

function mapArrayToAdoptStepResult(data: any) {
  const result: AdoptStepResult = {
    kind: data[0],
  };
  return result;
}
