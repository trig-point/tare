import type { Database } from "better-sqlite3";

export type ListLimitsParams = {
  user_id: number;
};

export type ListLimitsResult = {
  id: number;
  body_area: string;
  description: string;
  movements: string;
  status: string;
  date_noted: string;
};

export function listLimits(
  db: Database,
  params: ListLimitsParams,
): ListLimitsResult[] {
  const sql = `
	SELECT id, body_area, description, movements, status, date_noted
	FROM training_limits
	WHERE user_id = ? AND status = 'active'
	ORDER BY id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id]);

  return rows.map((data) => mapArrayToListLimitsResult(data));
}

function mapArrayToListLimitsResult(data: any) {
  const result: ListLimitsResult = {
    id: data[0],
    body_area: data[1],
    description: data[2],
    movements: data[3],
    status: data[4],
    date_noted: data[5],
  };
  return result;
}
