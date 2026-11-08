import type { Database } from "better-sqlite3";

export type MarkMembershipData = {
  now: string;
};

export type MarkMembershipParams = {
  user_id: number;
};

export type MarkMembershipResult = {
  user_id: number;
};

export function markMembership(
  db: Database,
  data: MarkMembershipData,
  params: MarkMembershipParams,
): MarkMembershipResult | null {
  const sql = `
	UPDATE oura_connections SET status = 'membership_required', updated_at = ?
	WHERE user_id = ? AND status = 'connected'
	RETURNING user_id;
	
	`;
  const res = db.prepare(sql).raw(true).get([data.now, params.user_id]);

  return res ? mapArrayToMarkMembershipResult(res) : null;
}

function mapArrayToMarkMembershipResult(data: any) {
  const result: MarkMembershipResult = {
    user_id: data[0],
  };
  return result;
}
