import type { Database } from "better-sqlite3";

export type ShortenHoldData = {
  to_date: string;
};

export type ShortenHoldParams = {
  id: number;
};

export type ShortenHoldResult = {
  id: number;
  medication_id: number;
  from_date: string;
  to_date: string;
};

export function shortenHold(
  db: Database,
  data: ShortenHoldData,
  params: ShortenHoldParams,
): ShortenHoldResult | null {
  const sql = `
	UPDATE medication_holds SET to_date = ? WHERE id = ?
	RETURNING *
	
	`;
  const res = db.prepare(sql).raw(true).get([data.to_date, params.id]);

  return res ? mapArrayToShortenHoldResult(res) : null;
}

function mapArrayToShortenHoldResult(data: any) {
  const result: ShortenHoldResult = {
    id: data[0],
    medication_id: data[1],
    from_date: data[2],
    to_date: data[3],
  };
  return result;
}
