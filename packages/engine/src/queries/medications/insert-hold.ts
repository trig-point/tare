import type { Database } from "better-sqlite3";

export type InsertHoldParams = {
  medication_id: number;
  from_date: string;
  to_date: string;
};

export type InsertHoldResult = {
  id: number;
  medication_id: number;
  from_date: string;
  to_date: string;
};

export function insertHold(
  db: Database,
  params: InsertHoldParams,
): InsertHoldResult | null {
  const sql = `
	INSERT INTO medication_holds (medication_id, from_date, to_date)
	VALUES (?, ?, ?)
	RETURNING *
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.medication_id, params.from_date, params.to_date]);

  return res ? mapArrayToInsertHoldResult(res) : null;
}

function mapArrayToInsertHoldResult(data: any) {
  const result: InsertHoldResult = {
    id: data[0],
    medication_id: data[1],
    from_date: data[2],
    to_date: data[3],
  };
  return result;
}
