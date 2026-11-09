import type { Database } from "better-sqlite3";

export type SelectLastSyncParams = {
  user_id: number;
};

export type SelectLastSyncResult = {
  last_synced_at: string | null;
};

export function selectLastSync(
  db: Database,
  params: SelectLastSyncParams,
): SelectLastSyncResult | null {
  const sql = `
	SELECT last_synced_at FROM oura_connections WHERE user_id = ?;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id]);

  return res ? mapArrayToSelectLastSyncResult(res) : null;
}

function mapArrayToSelectLastSyncResult(data: any) {
  const result: SelectLastSyncResult = {
    last_synced_at: data[0],
  };
  return result;
}
