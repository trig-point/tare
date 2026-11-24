import type { Database } from "better-sqlite3";

export type SetHorizonData = {
  generated_until: string;
};

export type SetHorizonParams = {
  id: number;
};

export type SetHorizonResult = {
  changes: number;
};

export function setHorizon(
  db: Database,
  data: SetHorizonData,
  params: SetHorizonParams,
): SetHorizonResult {
  const sql = `
	UPDATE medications SET generated_until = ? WHERE id = ?
	
	`;
  return db
    .prepare(sql)
    .run([data.generated_until, params.id]) as SetHorizonResult;
}
