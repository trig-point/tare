import type { Database } from "better-sqlite3";

export type ArchiveRegularMealData = {
  archived_at: string | null;
};

export type ArchiveRegularMealParams = {
  user_id: number;
  id: number;
};

export type ArchiveRegularMealResult = {
  food_id: number;
};

export function archiveRegularMeal(
  db: Database,
  data: ArchiveRegularMealData,
  params: ArchiveRegularMealParams,
): ArchiveRegularMealResult[] {
  const sql = `
	UPDATE regular_meals SET archived_at = ?
	WHERE user_id = ? AND food_id = ? AND archived_at IS NULL RETURNING food_id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([data.archived_at, params.user_id, params.id]);

  return rows.map((data) => mapArrayToArchiveRegularMealResult(data));
}

function mapArrayToArchiveRegularMealResult(data: any) {
  const result: ArchiveRegularMealResult = {
    food_id: data[0],
  };
  return result;
}
