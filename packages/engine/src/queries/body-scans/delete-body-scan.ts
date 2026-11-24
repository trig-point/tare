import type { Database } from "better-sqlite3";

export type DeleteBodyScanParams = {
  user_id: number;
  id: number;
};

export type DeleteBodyScanResult = {
  id: number;
};

export function deleteBodyScan(
  db: Database,
  params: DeleteBodyScanParams,
): DeleteBodyScanResult[] {
  const sql = `
	DELETE FROM body_scans WHERE user_id = ? AND id = ? RETURNING id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id, params.id]);

  return rows.map((data) => mapArrayToDeleteBodyScanResult(data));
}

function mapArrayToDeleteBodyScanResult(data: any) {
  const result: DeleteBodyScanResult = {
    id: data[0],
  };
  return result;
}
