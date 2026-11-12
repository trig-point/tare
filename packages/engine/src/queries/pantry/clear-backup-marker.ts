import type { Database } from "better-sqlite3";

export type ClearBackupMarkerResult = {
  changes: number;
};

export function clearBackupMarker(db: Database): ClearBackupMarkerResult {
  const sql = `
	DELETE FROM pantry_backup_marker;
	
	`;
  return db.prepare(sql).run() as ClearBackupMarkerResult;
}
