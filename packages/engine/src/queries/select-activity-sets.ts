import type { Database } from "better-sqlite3";

export type SelectActivitySetsParams = {
  user_id: number;
  from: string;
  to: string;
};

export type SelectActivitySetsResult = {
  session_id: number;
  set_index: number;
  exercise: string;
  set_type: string;
  reps: number | null;
  load_kg: number | null;
  load_unit: string | null;
  duration_seconds: number | null;
  rir_low: number | null;
  rir_high: number | null;
  notes: string | null;
};

export function selectActivitySets(
  db: Database,
  params: SelectActivitySetsParams,
): SelectActivitySetsResult[] {
  const sql = `
	SELECT activity_sets.session_id, activity_sets.set_index, activity_sets.exercise, activity_sets.set_type, activity_sets.reps,
	  activity_sets.load_kg, activity_sets.load_unit, activity_sets.duration_seconds, activity_sets.rir_low, activity_sets.rir_high, activity_sets.notes
	FROM activity_sets JOIN activity_sessions
	  ON activity_sessions.user_id = activity_sets.user_id AND activity_sessions.id = activity_sets.session_id
	WHERE activity_sets.user_id = ? AND activity_sessions.day BETWEEN ? AND ?
	ORDER BY activity_sets.session_id, activity_sets.set_index;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.from, params.to]);

  return rows.map((data) => mapArrayToSelectActivitySetsResult(data));
}

function mapArrayToSelectActivitySetsResult(data: any) {
  const result: SelectActivitySetsResult = {
    session_id: data[0],
    set_index: data[1],
    exercise: data[2],
    set_type: data[3],
    reps: data[4],
    load_kg: data[5],
    load_unit: data[6],
    duration_seconds: data[7],
    rir_low: data[8],
    rir_high: data[9],
    notes: data[10],
  };
  return result;
}
