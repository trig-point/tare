import type { Database } from "better-sqlite3";

export type FinalizeStepData = {
  state: string;
  reason: string | null;
  object_id: number | null;
  transaction_id: string | null;
  now: string;
};

export type FinalizeStepParams = {
  claim_token: string;
};

export type FinalizeStepResult = {
  request_id: number;
  number: number;
};

export function finalizeStep(
  db: Database,
  data: FinalizeStepData,
  params: FinalizeStepParams,
): FinalizeStepResult[] {
  const sql = `
	UPDATE grocery_steps SET state = ?, reason = ?, claim_token = NULL, object_id = ?, transaction_id = ?, updated_at = ?
	WHERE claim_token = ? AND state = 'sending'
	RETURNING request_id, number;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      data.state,
      data.reason,
      data.object_id,
      data.transaction_id,
      data.now,
      params.claim_token,
    ]);

  return rows.map((data) => mapArrayToFinalizeStepResult(data));
}

function mapArrayToFinalizeStepResult(data: any) {
  const result: FinalizeStepResult = {
    request_id: data[0],
    number: data[1],
  };
  return result;
}
