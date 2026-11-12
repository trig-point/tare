import type { Database } from "better-sqlite3";

export type ReadRequestParams = {
  user_id: number;
  mutation_id: string;
};

export type ReadRequestResult = {
  id: number;
  user_id: number;
  mutation_id: string;
  plan_hash: string;
  plan: string;
  generation: number;
  url: string;
  username: string;
  restore_nonce: string;
  food_id: number;
  food_fingerprint: string;
  state: string;
  created_at: string;
  updated_at: string;
};

export function readRequest(
  db: Database,
  params: ReadRequestParams,
): ReadRequestResult | null {
  const sql = `
	SELECT * FROM grocery_requests WHERE user_id = ? AND mutation_id = ? LIMIT 1;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.mutation_id]);

  return res ? mapArrayToReadRequestResult(res) : null;
}

function mapArrayToReadRequestResult(data: any) {
  const result: ReadRequestResult = {
    id: data[0],
    user_id: data[1],
    mutation_id: data[2],
    plan_hash: data[3],
    plan: data[4],
    generation: data[5],
    url: data[6],
    username: data[7],
    restore_nonce: data[8],
    food_id: data[9],
    food_fingerprint: data[10],
    state: data[11],
    created_at: data[12],
    updated_at: data[13],
  };
  return result;
}
