import type { Database } from "better-sqlite3";

export type DeleteMovementParams = {
  user_id: number;
  name: string;
};

export type DeleteMovementResult = {
  id: number;
};

export function deleteMovement(
  db: Database,
  params: DeleteMovementParams,
): DeleteMovementResult[] {
  const sql = `
	DELETE FROM movements WHERE user_id = ? AND lower(name) = lower(?) RETURNING id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id, params.name]);

  return rows.map((data) => mapArrayToDeleteMovementResult(data));
}

function mapArrayToDeleteMovementResult(data: any) {
  const result: DeleteMovementResult = {
    id: data[0],
  };
  return result;
}
