import type { Database } from "better-sqlite3";

export type SelectActivitySetRemovalParams = {
  user_id: number;
  session_id: number;
  client_set_id: string;
};

export type SelectActivitySetRemovalResult = {
  client_set_id: string;
};

export function selectActivitySetRemoval(
  db: Database,
  params: SelectActivitySetRemovalParams,
): SelectActivitySetRemovalResult | null {
  const sql = `
	SELECT client_set_id FROM activity_set_removals
	WHERE user_id = ? AND session_id = ? AND client_set_id = ?
	LIMIT 1;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.session_id, params.client_set_id]);

  return res ? mapArrayToSelectActivitySetRemovalResult(res) : null;
}

function mapArrayToSelectActivitySetRemovalResult(data: any) {
  const result: SelectActivitySetRemovalResult = {
    client_set_id: data[0],
  };
  return result;
}
