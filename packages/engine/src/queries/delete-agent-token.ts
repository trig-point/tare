import type { Database } from "better-sqlite3";

export type DeleteAgentTokenParams = {
  user_id: number;
  id: number;
};

export type DeleteAgentTokenResult = {
  id: number;
};

export function deleteAgentToken(
  db: Database,
  params: DeleteAgentTokenParams,
): DeleteAgentTokenResult[] {
  const sql = `
	DELETE FROM agent_tokens WHERE user_id = ? AND id = ? RETURNING id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id, params.id]);

  return rows.map((data) => mapArrayToDeleteAgentTokenResult(data));
}

function mapArrayToDeleteAgentTokenResult(data: any) {
  const result: DeleteAgentTokenResult = {
    id: data[0],
  };
  return result;
}
