import type { Database } from "better-sqlite3";

export type RecordSyncData = {
  now: string | null;
};

export type RecordSyncParams = {
  user_id: number;
};

export type RecordSyncResult = {
  user_id: number;
};

export function recordSync(
  db: Database,
  data: RecordSyncData,
  params: RecordSyncParams,
): RecordSyncResult | null {
  const sql = `
	UPDATE oura_connections SET last_synced_at = ?, scores_backfilled_at = coalesce(scores_backfilled_at, ?), status = 'connected', updated_at = ?
	WHERE user_id = ? AND status != 'reconnect_required'
	RETURNING user_id;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([data.now, data.now, data.now, params.user_id]);

  return res ? mapArrayToRecordSyncResult(res) : null;
}

function mapArrayToRecordSyncResult(data: any) {
  const result: RecordSyncResult = {
    user_id: data[0],
  };
  return result;
}
