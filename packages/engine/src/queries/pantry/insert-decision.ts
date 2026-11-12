import type { Database } from "better-sqlite3";

export type InsertDecisionParams = {
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

export type InsertDecisionResult = {
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

export function insertDecision(
  db: Database,
  params: InsertDecisionParams,
): InsertDecisionResult | null {
  const sql = `
	INSERT INTO pantry_decisions (id, request_id, user_id, mutation_id, number, kind, decision, resulting_state, created_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT DO NOTHING RETURNING *;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.id,
      params.request_id,
      params.user_id,
      params.mutation_id,
      params.number,
      params.kind,
      params.decision,
      params.resulting_state,
      params.created_at,
    ]);

  return res ? mapArrayToInsertDecisionResult(res) : null;
}

function mapArrayToInsertDecisionResult(data: any) {
  const result: InsertDecisionResult = {
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
