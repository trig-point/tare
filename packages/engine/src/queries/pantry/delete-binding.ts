import type { Database } from "better-sqlite3";

export type DeleteBindingParams = {
  user_id: number;
  generation: number;
  reference_kind: string;
  reference_id: number;
};

export type DeleteBindingResult = {
  changes: number;
};

export function deleteBinding(
  db: Database,
  params: DeleteBindingParams,
): DeleteBindingResult {
  const sql = `
	DELETE FROM pantry_bindings WHERE user_id = ? AND generation = ? AND reference_kind = ? AND reference_id = ?;
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.generation,
      params.reference_kind,
      params.reference_id,
    ]) as DeleteBindingResult;
}
