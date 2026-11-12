import type { Database } from "better-sqlite3";

export type AdoptStepData = {
  object_id: number | null;
  transaction_id: string | null;
  now: string;
};

export type AdoptStepParams = {
  request_id: number;
  number: number;
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
	UPDATE grocery_steps SET state = 'adopted', object_id = ?, transaction_id = ?, updated_at = ?
	WHERE request_id = ? AND number = ? AND state = 'uncertain'
	RETURNING kind;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      data.object_id,
      data.transaction_id,
      data.now,
      params.request_id,
      params.number,
    ]);

  return rows.map((data) => mapArrayToAdoptStepResult(data));
}

function mapArrayToAdoptStepResult(data: any) {
  const result: AdoptStepResult = {
    kind: data[0],
  };
  return result;
}
