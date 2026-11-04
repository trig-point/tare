import type { Database } from "better-sqlite3";

export type MarkPlannedItemData = {
  state: string;
  updated_at: string;
};

export type MarkPlannedItemParams = {
  user_id: number;
  id: number;
  revision: number;
};

export type MarkPlannedItemResult = {
  id: number;
  revision: number;
  state: string;
};

export function markPlannedItem(
  db: Database,
  data: MarkPlannedItemData,
  params: MarkPlannedItemParams,
): MarkPlannedItemResult[] {
  const sql = `
	UPDATE planned_items SET state = ?, revision = revision + 1, updated_at = ?
	WHERE user_id = ? AND id = ? AND revision = ? AND state = 'planned'
	RETURNING id, revision, state;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      data.state,
      data.updated_at,
      params.user_id,
      params.id,
      params.revision,
    ]);

  return rows.map((data) => mapArrayToMarkPlannedItemResult(data));
}

function mapArrayToMarkPlannedItemResult(data: any) {
  const result: MarkPlannedItemResult = {
    id: data[0],
    revision: data[1],
    state: data[2],
  };
  return result;
}
