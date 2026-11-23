import type { Database } from "better-sqlite3";

export type ListHoldsParams = {
  medication_id: number;
};

export type ListHoldsResult = {
  id: number;
  medication_id: number;
  from_date: string;
  to_date: string;
};

export function listHolds(
  db: Database,
  params: ListHoldsParams,
): ListHoldsResult[] {
  const sql = `
	SELECT * FROM medication_holds WHERE medication_id = ? ORDER BY from_date, id
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.medication_id]);

  return rows.map((data) => mapArrayToListHoldsResult(data));
}

function mapArrayToListHoldsResult(data: any) {
  const result: ListHoldsResult = {
    id: data[0],
    medication_id: data[1],
    from_date: data[2],
    to_date: data[3],
  };
  return result;
}
