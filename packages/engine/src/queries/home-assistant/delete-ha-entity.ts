import type { Database } from "better-sqlite3";

export type DeleteHaEntityParams = {
  user_id: number;
  topic: string;
};

export type DeleteHaEntityResult = {
  changes: number;
};

export function deleteHaEntity(
  db: Database,
  params: DeleteHaEntityParams,
): DeleteHaEntityResult {
  const sql = `
	DELETE FROM ha_entities WHERE user_id = ? AND topic = ?;
	
	`;
  return db
    .prepare(sql)
    .run([params.user_id, params.topic]) as DeleteHaEntityResult;
}
