import type { Database } from "better-sqlite3";

export type UpdateDaySettingsData = {
  timezone: string;
  day_start_hour: number;
};

export type UpdateDaySettingsParams = {
  id: number;
};

export type UpdateDaySettingsResult = {
  id: number;
  username: string;
  timezone: string;
  day_start_hour: number;
  is_admin: number;
};

export function updateDaySettings(
  db: Database,
  data: UpdateDaySettingsData,
  params: UpdateDaySettingsParams,
): UpdateDaySettingsResult[] {
  const sql = `
	UPDATE users SET timezone = ?, day_start_hour = ? WHERE id = ?
	RETURNING id, username, timezone, day_start_hour, is_admin;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([data.timezone, data.day_start_hour, params.id]);

  return rows.map((data) => mapArrayToUpdateDaySettingsResult(data));
}

function mapArrayToUpdateDaySettingsResult(data: any) {
  const result: UpdateDaySettingsResult = {
    id: data[0],
    username: data[1],
    timezone: data[2],
    day_start_hour: data[3],
    is_admin: data[4],
  };
  return result;
}
