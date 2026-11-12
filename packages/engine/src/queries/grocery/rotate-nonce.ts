import type { Database } from "better-sqlite3";

export type RotateNonceData = {
  nonce: string;
};

export type RotateNonceResult = {
  changes: number;
};

export function rotateNonce(
  db: Database,
  data: RotateNonceData,
): RotateNonceResult {
  const sql = `
	UPDATE grocery_restore_nonce SET nonce = ? WHERE EXISTS (SELECT 1 FROM pantry_backup_marker);
	
	`;
  return db.prepare(sql).run([data.nonce]) as RotateNonceResult;
}
