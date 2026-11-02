import type { Database } from "better-sqlite3";

export type UpdateUserSettingsData = {
  day_start_hour: number;
};

export type UpdateUserSettingsParams = {
  id: number;
};

export type UpdateUserSettingsResult = {
  id: number;
  username: string;
  password_hash: string | null;
  timezone: string;
  day_start_hour: number;
  is_admin: number;
  created_at: string;
  access_email: string | null;
};

export function updateUserSettings(
  db: Database,
  data: UpdateUserSettingsData,
  params: UpdateUserSettingsParams,
): UpdateUserSettingsResult[] {
  const sql = `
	UPDATE users SET day_start_hour = ? WHERE id = ? RETURNING *;
	
	`;
  const rows = db.prepare(sql).raw(true).all([data.day_start_hour, params.id]);

  return rows.map((data) => mapArrayToUpdateUserSettingsResult(data));
}

function mapArrayToUpdateUserSettingsResult(data: any) {
  const result: UpdateUserSettingsResult = {
    id: data[0],
    username: data[1],
    password_hash: data[2],
    timezone: data[3],
    day_start_hour: data[4],
    is_admin: data[5],
    created_at: data[6],
    access_email: data[7],
  };
  return result;
}
