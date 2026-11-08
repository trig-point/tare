import type { Database } from "better-sqlite3";

export type ListSyncPeopleResult = {
  user_id: number;
  last_synced_at: string | null;
  timezone: string;
  day_start_hour: number;
};

export function listSyncPeople(db: Database): ListSyncPeopleResult[] {
  const sql = `
	SELECT oura_connections.user_id, oura_connections.last_synced_at, users.timezone, users.day_start_hour
	FROM oura_connections JOIN users ON users.id = oura_connections.user_id
	WHERE oura_connections.status != 'reconnect_required'
	ORDER BY oura_connections.user_id;
	
	`;
  const rows = db.prepare(sql).raw(true).all();

  return rows.map((data) => mapArrayToListSyncPeopleResult(data));
}

function mapArrayToListSyncPeopleResult(data: any) {
  const result: ListSyncPeopleResult = {
    user_id: data[0],
    last_synced_at: data[1],
    timezone: data[2],
    day_start_hour: data[3],
  };
  return result;
}
