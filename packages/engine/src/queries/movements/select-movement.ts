import type { Database } from "better-sqlite3";

export type SelectMovementParams = {
  user_id: number;
  name: string;
};

export type SelectMovementResult = {
  id: number;
  name: string;
  setup: string;
  cues: string;
  mistakes: string;
  safety: string;
  pictures: string;
  rest_seconds: number | null;
  source: string | null;
  equipment: string | null;
  sessions: number | null;
};

export function selectMovement(
  db: Database,
  params: SelectMovementParams,
): SelectMovementResult[] {
  const sql = `
	SELECT id, name, setup, cues, mistakes, safety, pictures, rest_seconds, source, equipment,
	  (SELECT count(DISTINCT activity_sets.session_id) FROM activity_sets WHERE activity_sets.user_id = movements.user_id AND lower(activity_sets.exercise) = lower(movements.name)) AS sessions
	FROM movements
	WHERE user_id = ? AND lower(name) = lower(?);
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id, params.name]);

  return rows.map((data) => mapArrayToSelectMovementResult(data));
}

function mapArrayToSelectMovementResult(data: any) {
  const result: SelectMovementResult = {
    id: data[0],
    name: data[1],
    setup: data[2],
    cues: data[3],
    mistakes: data[4],
    safety: data[5],
    pictures: data[6],
    rest_seconds: data[7],
    source: data[8],
    equipment: data[9],
    sessions: data[10],
  };
  return result;
}
