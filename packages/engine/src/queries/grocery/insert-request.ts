import type { Database } from "better-sqlite3";

export type InsertRequestParams = {
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
  created_at: string;
};

export type InsertRequestResult = {
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

export function insertRequest(
  db: Database,
  params: InsertRequestParams,
): InsertRequestResult | null {
  const sql = `
	INSERT INTO grocery_requests (user_id, mutation_id, plan_hash, plan, generation, url, username, restore_nonce, food_id, food_fingerprint, state, created_at, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
	RETURNING *;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.mutation_id,
      params.plan_hash,
      params.plan,
      params.generation,
      params.url,
      params.username,
      params.restore_nonce,
      params.food_id,
      params.food_fingerprint,
      params.created_at,
      params.created_at,
    ]);

  return res ? mapArrayToInsertRequestResult(res) : null;
}

function mapArrayToInsertRequestResult(data: any) {
  const result: InsertRequestResult = {
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
