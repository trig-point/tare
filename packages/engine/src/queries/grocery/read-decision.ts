import type { Database } from "better-sqlite3";

export type ReadDecisionParams = {
  user_id: number;
  mutation_id: string;
};

export type ReadDecisionResult = {
  decision_hash: string;
  request_id: number;
  step_number: number | null;
  decision: string;
  resulting_state: string;
};

export function readDecision(
  db: Database,
  params: ReadDecisionParams,
): ReadDecisionResult | null {
  const sql = `
	SELECT decision_hash, request_id, step_number, decision, resulting_state FROM grocery_decisions WHERE user_id = ? AND mutation_id = ?;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.mutation_id]);

  return res ? mapArrayToReadDecisionResult(res) : null;
}

function mapArrayToReadDecisionResult(data: any) {
  const result: ReadDecisionResult = {
    decision_hash: data[0],
    request_id: data[1],
    step_number: data[2],
    decision: data[3],
    resulting_state: data[4],
  };
  return result;
}
