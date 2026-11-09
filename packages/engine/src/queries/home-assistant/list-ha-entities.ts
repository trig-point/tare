import type { Database } from "better-sqlite3";

export type ListHaEntitiesResult = {
  user_id: number;
  topic: string;
};

export function listHaEntities(db: Database): ListHaEntitiesResult[] {
  const sql = `
	SELECT user_id, topic FROM ha_entities ORDER BY user_id, topic;
	
	`;
  const rows = db.prepare(sql).raw(true).all();

  return rows.map((data) => mapArrayToListHaEntitiesResult(data));
}

function mapArrayToListHaEntitiesResult(data: any) {
  const result: ListHaEntitiesResult = {
    user_id: data[0],
    topic: data[1],
  };
  return result;
}
