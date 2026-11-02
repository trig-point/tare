import type { Database } from "better-sqlite3";

export type SelectAgentTokensParams = {
  user_id: number;
};

export type SelectAgentTokensResult = {
  id: number;
  user_id: number;
  client_id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
};

export function selectAgentTokens(
  db: Database,
  params: SelectAgentTokensParams,
): SelectAgentTokensResult[] {
  const sql = `
	SELECT * FROM agent_tokens WHERE user_id = ? ORDER BY created_at DESC, id DESC;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id]);

  return rows.map((data) => mapArrayToSelectAgentTokensResult(data));
}

function mapArrayToSelectAgentTokensResult(data: any) {
  const result: SelectAgentTokensResult = {
    id: data[0],
    user_id: data[1],
    client_id: data[2],
    name: data[3],
    created_at: data[4],
    last_used_at: data[5],
  };
  return result;
}
