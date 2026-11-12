import type { Database } from "better-sqlite3";

export type ClearBindingsResult = {
  changes: number;
};

export function clearBindings(db: Database): ClearBindingsResult {
  const sql = `
	DELETE FROM pantry_bindings;
	
	`;
  return db.prepare(sql).run() as ClearBindingsResult;
}
