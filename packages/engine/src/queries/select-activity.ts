import type { Database } from "better-sqlite3";

export type SelectActivityParams = {
  user_id: number;
  id: number;
};

export type SelectActivityResult = {
  id: number;
  user_id: number;
  client_id: string | null;
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

export function selectActivity(
  db: Database,
  params: SelectActivityParams,
): SelectActivityResult | null {
  const sql = `
	SELECT * FROM activity_sessions WHERE user_id = ? AND id = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.id]);

  return res ? mapArrayToSelectActivityResult(res) : null;
}

function mapArrayToSelectActivityResult(data: any) {
  const result: SelectActivityResult = {
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
