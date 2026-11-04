import type { Database } from "better-sqlite3";

export type DetachPlannedItemsData = {
  updated_at: string;
};

export type DetachPlannedItemsParams = {
  user_id: number;
  template_id: number;
};

export type DetachPlannedItemsResult = {
  changes: number;
};

export function detachPlannedItems(
  db: Database,
  data: DetachPlannedItemsData,
  params: DetachPlannedItemsParams,
): DetachPlannedItemsResult {
  const sql = `
	UPDATE planned_items SET template_id = NULL, position = NULL,
	revision = revision + CASE WHEN state = 'planned' THEN 1 ELSE 0 END, updated_at = ?
	WHERE user_id = ? AND template_id = ?;
	
	`;
  return db
    .prepare(sql)
    .run([
      data.updated_at,
      params.user_id,
      params.template_id,
    ]) as DetachPlannedItemsResult;
}
