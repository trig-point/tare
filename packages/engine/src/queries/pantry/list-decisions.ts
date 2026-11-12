import type { Database } from "better-sqlite3";

export type ListDecisionsParams = {
  request_id: string;
};

export type ListDecisionsResult = {
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

export function listDecisions(
  db: Database,
  params: ListDecisionsParams,
): ListDecisionsResult[] {
  const sql = `
	SELECT * FROM pantry_decisions WHERE request_id = ? ORDER BY created_at, number, kind;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.request_id]);

  return rows.map((data) => mapArrayToListDecisionsResult(data));
}

function mapArrayToListDecisionsResult(data: any) {
  const result: ListDecisionsResult = {
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
