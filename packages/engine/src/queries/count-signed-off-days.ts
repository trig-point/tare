import type { Database } from "better-sqlite3";

export type CountSignedOffDaysParams = {
  user_id: number;
};

export type CountSignedOffDaysResult = {
  count: number;
};

export function countSignedOffDays(
  db: Database,
  params: CountSignedOffDaysParams,
): CountSignedOffDaysResult | null {
  const sql = `
	SELECT COUNT(*) AS count FROM days
	WHERE user_id = ? AND signed_off_at IS NOT NULL;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id]);

  return res ? mapArrayToCountSignedOffDaysResult(res) : null;
}

function mapArrayToCountSignedOffDaysResult(data: any) {
  const result: CountSignedOffDaysResult = {
    count: data[0],
  };
  return result;
}
