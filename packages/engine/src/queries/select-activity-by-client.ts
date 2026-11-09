import type { Database } from "better-sqlite3";

export type SelectActivityByClientParams = {
  user_id: number;
  client_id: string;
};

export type SelectActivityByClientResult = {
  id: number;
  user_id: number;
  client_id: string;
  timing: string;
  started_at: string | null;
  day: string;
  duration_minutes: number | null;
  kind: string;
  calories: number | null;
  notes: string | null;
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
    timing: data[3],
    started_at: data[4],
    day: data[5],
    duration_minutes: data[6],
    kind: data[7],
    calories: data[8],
    notes: data[9],
    source: data[10],
    source_record_id: data[11],
    created_at: data[12],
  };
  return result;
}
