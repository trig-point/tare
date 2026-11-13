import type { Database } from "better-sqlite3";

export type ListOpenParams = {
  limit: number;
};

export type ListOpenResult = {
  id: number;
  user_id: number;
  mutation_id: string;
  generation: number;
  state: string;
  created_at: string;
};

export function listOpen(
  db: Database,
  params: ListOpenParams,
): ListOpenResult[] {
  const sql = `
	SELECT id, user_id, mutation_id, generation, state, created_at FROM grocery_requests WHERE state IN ('open', 'binding_pending') ORDER BY id LIMIT ?;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.limit]);

  return rows.map((data) => mapArrayToListOpenResult(data));
}

function mapArrayToListOpenResult(data: any) {
  const result: ListOpenResult = {
    id: data[0],
    user_id: data[1],
    mutation_id: data[2],
    generation: data[3],
    state: data[4],
    created_at: data[5],
  };
  return result;
}
