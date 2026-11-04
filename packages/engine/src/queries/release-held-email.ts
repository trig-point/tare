import type { Database } from "better-sqlite3";

export type ReleaseHeldEmailData = {
  now: string | null;
};

export type ReleaseHeldEmailParams = {
  user_id: number;
  id: number;
};

export type ReleaseHeldEmailResult = {
  changes: number;
};

export function releaseHeldEmail(
  db: Database,
  data: ReleaseHeldEmailData,
  params: ReleaseHeldEmailParams,
): ReleaseHeldEmailResult {
  const sql = `
	UPDATE inbound_emails SET parse_state = 'queued', released_at = ?, updated_at = ?
	WHERE user_id = ? AND id = ? AND parse_state = 'held' AND disposition IS NULL;
	
	`;
  return db
    .prepare(sql)
    .run([
      data.now,
      data.now,
      params.user_id,
      params.id,
    ]) as ReleaseHeldEmailResult;
}
