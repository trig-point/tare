import type { Database } from "better-sqlite3";

export type SelectCalendarSettingsParams = {
  user_id: number;
};

export type SelectCalendarSettingsResult = {
  user_id: number;
  feed_url: string | null;
  enabled: number;
  revision: number;
};

export function selectCalendarSettings(
  db: Database,
  params: SelectCalendarSettingsParams,
): SelectCalendarSettingsResult | null {
  const sql = `
	SELECT user_id, feed_url, enabled, revision FROM calendar_settings WHERE user_id = ?;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id]);

  return res ? mapArrayToSelectCalendarSettingsResult(res) : null;
}

function mapArrayToSelectCalendarSettingsResult(data: any) {
  const result: SelectCalendarSettingsResult = {
    user_id: data[0],
    feed_url: data[1],
    enabled: data[2],
    revision: data[3],
  };
  return result;
}
