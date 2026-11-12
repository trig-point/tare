import type { Database } from "better-sqlite3";

export type UpdateBindingStatusData = {
  status: string;
};

export type UpdateBindingStatusParams = {
  user_id: number;
  generation: number;
  reference_kind: string;
  reference_id: number;
  change_token: string;
};

export type UpdateBindingStatusResult = {
  changes: number;
};

export function updateBindingStatus(
  db: Database,
  data: UpdateBindingStatusData,
  params: UpdateBindingStatusParams,
): UpdateBindingStatusResult {
  const sql = `
	UPDATE pantry_bindings SET status = ? WHERE user_id = ? AND generation = ? AND reference_kind = ? AND reference_id = ? AND change_token = ?;
	
	`;
  return db
    .prepare(sql)
    .run([
      data.status,
      params.user_id,
      params.generation,
      params.reference_kind,
      params.reference_id,
      params.change_token,
    ]) as UpdateBindingStatusResult;
}
