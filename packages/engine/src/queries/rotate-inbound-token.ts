import type { Database } from "better-sqlite3";

export type RotateInboundTokenData = {
  token_hash: string;
  created_at: string;
};

export type RotateInboundTokenParams = {
  user_id: number;
};

export type RotateInboundTokenResult = {
  user_id: number;
};

export function rotateInboundToken(
  db: Database,
  data: RotateInboundTokenData,
  params: RotateInboundTokenParams,
): RotateInboundTokenResult[] {
  const sql = `
	UPDATE inbound_tokens SET token_hash = ?, created_at = ?
	WHERE user_id = ? RETURNING user_id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([data.token_hash, data.created_at, params.user_id]);

  return rows.map((data) => mapArrayToRotateInboundTokenResult(data));
}

function mapArrayToRotateInboundTokenResult(data: any) {
  const result: RotateInboundTokenResult = {
    user_id: data[0],
  };
  return result;
}
