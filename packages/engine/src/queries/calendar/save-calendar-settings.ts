import type { Database } from "better-sqlite3";

export type SaveCalendarSettingsParams = {
  user_id: number | null;
  feed_url: string | null;
  enabled: number;
  now: string;
};

export type SaveCalendarSettingsResult = {
  changes: number;
  lastInsertRowid: number;
};

export function saveCalendarSettings(
  db: Database,
  params: SaveCalendarSettingsParams,
): SaveCalendarSettingsResult {
  const sql = `
	INSERT INTO calendar_settings (user_id, feed_url, enabled, revision, created_at, updated_at)
	VALUES (?, ?, ?, 1, ?, ?)
	ON CONFLICT (user_id) DO UPDATE SET feed_url = excluded.feed_url, enabled = excluded.enabled,
	revision = calendar_settings.revision + 1, updated_at = excluded.updated_at;
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.feed_url,
      params.enabled,
      params.now,
      params.now,
    ]) as SaveCalendarSettingsResult;
}
