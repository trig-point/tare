import type { Database } from "better-sqlite3";

export type SelectActivityByClientParams = {
  user_id: number;
  client_id: string;
};

export type SelectActivityByClientResult = {
  id: number;
  user_id: number;
  client_id: string;
  started_at: string;
  day: string;
  duration_minutes: number;
  kind: string;
  calories: number | null;
  source: string;
  source_record_id: string | null;
  created_at: string;
};

export function selectActivityByClient(
  db: Database,
  params: SelectActivityByClientParams,
): SelectActivityByClientResult | null {
  const sql = `
	SELECT * FROM activity_sessions WHERE user_id = ? AND client_id = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.client_id]);

  return res ? mapArrayToSelectActivityByClientResult(res) : null;
}

function mapArrayToSelectActivityByClientResult(data: any) {
  const result: SelectActivityByClientResult = {
    id: data[0],
    user_id: data[1],
    client_id: data[2],
    started_at: data[3],
    day: data[4],
    duration_minutes: data[5],
    kind: data[6],
    calories: data[7],
    source: data[8],
    source_record_id: data[9],
    created_at: data[10],
  };
  return result;
}
