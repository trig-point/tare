import type { Database } from "better-sqlite3";

export type UseAgentTokenData = {
  now: string | null;
};

export type UseAgentTokenParams = {
  client_id: string;
};

export type UseAgentTokenResult = {
  user_id: number;
};

export function useAgentToken(
  db: Database,
  data: UseAgentTokenData,
  params: UseAgentTokenParams,
): UseAgentTokenResult[] {
  const sql = `
	UPDATE agent_tokens SET last_used_at = ? WHERE client_id = ? RETURNING user_id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([data.now, params.client_id]);

  return rows.map((data) => mapArrayToUseAgentTokenResult(data));
}

function mapArrayToUseAgentTokenResult(data: any) {
  const result: UseAgentTokenResult = {
    user_id: data[0],
  };
  return result;
}
