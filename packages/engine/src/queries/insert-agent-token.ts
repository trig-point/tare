import type { Database } from "better-sqlite3";

export type InsertAgentTokenParams = {
  user_id: number;
  client_id: string;
  name: string;
  created_at: string;
};

export type InsertAgentTokenResult = {
  id: number;
  user_id: number;
  client_id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
};

export function insertAgentToken(
  db: Database,
  params: InsertAgentTokenParams,
): InsertAgentTokenResult | null {
  const sql = `
	INSERT INTO agent_tokens (user_id, client_id, name, created_at)
	VALUES (?, ?, ?, ?)
	RETURNING *;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.client_id, params.name, params.created_at]);

  return res ? mapArrayToInsertAgentTokenResult(res) : null;
}

function mapArrayToInsertAgentTokenResult(data: any) {
  const result: InsertAgentTokenResult = {
    id: data[0],
    user_id: data[1],
    client_id: data[2],
    name: data[3],
    created_at: data[4],
    last_used_at: data[5],
  };
  return result;
}
