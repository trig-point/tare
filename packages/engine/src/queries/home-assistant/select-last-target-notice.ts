import type { Database } from "better-sqlite3";

export type SelectLastTargetNoticeResult = {
  id: number;
};

export function selectLastTargetNotice(
  db: Database,
): SelectLastTargetNoticeResult | null {
  const sql = `
	SELECT coalesce(max(id), 0) AS id FROM target_notices;
	
	`;
  const res = db.prepare(sql).raw(true).get();

  return res ? mapArrayToSelectLastTargetNoticeResult(res) : null;
}

function mapArrayToSelectLastTargetNoticeResult(data: any) {
  const result: SelectLastTargetNoticeResult = {
    id: data[0],
  };
  return result;
}
