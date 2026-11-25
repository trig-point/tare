import type { Database } from "better-sqlite3";

export type UpdateLimitData = {
  body_area: string;
  description: string;
  movements: string;
  status: string;
  date_noted: string;
};

export type UpdateLimitParams = {
  user_id: number;
  id: number;
};

export type UpdateLimitResult = {
  id: number;
  body_area: string;
  description: string;
  movements: string;
  status: string;
  date_noted: string;
};

export function updateLimit(
  db: Database,
  data: UpdateLimitData,
  params: UpdateLimitParams,
): UpdateLimitResult | null {
  const sql = `
	UPDATE training_limits
	SET body_area = ?, description = ?, movements = ?, status = ?, date_noted = ?
	WHERE user_id = ? AND id = ?
	RETURNING id, body_area, description, movements, status, date_noted;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      data.body_area,
      data.description,
      data.movements,
      data.status,
      data.date_noted,
      params.user_id,
      params.id,
    ]);

  return res ? mapArrayToUpdateLimitResult(res) : null;
}

function mapArrayToUpdateLimitResult(data: any) {
  const result: UpdateLimitResult = {
    id: data[0],
    body_area: data[1],
    description: data[2],
    movements: data[3],
    status: data[4],
    date_noted: data[5],
  };
  return result;
}
