import type { Database } from "better-sqlite3";

export type MarkBackupResult = {
  changes: number;
  lastInsertRowid: number;
};

export function markBackup(db: Database): MarkBackupResult {
  const sql = `
	INSERT OR IGNORE INTO pantry_backup_marker (id) VALUES (1);
	
	`;
  return db.prepare(sql).run() as MarkBackupResult;
}
