import type { Database } from "better-sqlite3";

export type ReadDecisionParams = {
  user_id: number;
  mutation_id: string;
};

export type ReadDecisionResult = {
  id: string;
  request_id: string;
  user_id: number;
  mutation_id: string;
  number: number;
  kind: string;
  decision: string;
  resulting_state: string;
  created_at: string;
};

export function readDecision(
  db: Database,
  params: ReadDecisionParams,
): ReadDecisionResult[] {
  const sql = `
	SELECT * FROM pantry_decisions WHERE user_id = ? AND mutation_id = ?;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.mutation_id]);

  return rows.map((data) => mapArrayToReadDecisionResult(data));
}

function mapArrayToReadDecisionResult(data: any) {
  const result: ReadDecisionResult = {
    id: data[0],
    request_id: data[1],
    user_id: data[2],
    mutation_id: data[3],
    number: data[4],
    kind: data[5],
    decision: data[6],
    resulting_state: data[7],
    created_at: data[8],
  };
  return result;
}
