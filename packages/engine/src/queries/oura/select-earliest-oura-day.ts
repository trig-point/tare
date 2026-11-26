import type { Database } from "better-sqlite3";

export type SelectEarliestOuraDayParams = {
  user_id: number;
};

export type SelectEarliestOuraDayResult = {
  day: string;
};

export function selectEarliestOuraDay(
  db: Database,
  params: SelectEarliestOuraDayParams,
): SelectEarliestOuraDayResult | null {
  const sql = `
	SELECT day FROM daily_signals
	WHERE user_id = ? AND source = 'oura'
	ORDER BY day LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id]);

  return res ? mapArrayToSelectEarliestOuraDayResult(res) : null;
}

function mapArrayToSelectEarliestOuraDayResult(data: any) {
  const result: SelectEarliestOuraDayResult = {
    day: data[0],
  };
  return result;
}
