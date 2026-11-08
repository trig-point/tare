import type { Database } from "better-sqlite3";

export type DismissTargetNoticeData = {
  dismissed_at: string | null;
};

export type DismissTargetNoticeParams = {
  id: number;
  user_id: number;
};

export type DismissTargetNoticeResult = {
  id: number;
};

export function dismissTargetNotice(
  db: Database,
  data: DismissTargetNoticeData,
  params: DismissTargetNoticeParams,
): DismissTargetNoticeResult | null {
  const sql = `
	UPDATE target_notices SET dismissed_at = COALESCE(dismissed_at, ?)
	WHERE id = ? AND user_id = ?
	RETURNING id;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([data.dismissed_at, params.id, params.user_id]);

  return res ? mapArrayToDismissTargetNoticeResult(res) : null;
}

function mapArrayToDismissTargetNoticeResult(data: any) {
  const result: DismissTargetNoticeResult = {
    id: data[0],
  };
  return result;
}
