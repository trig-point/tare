import type { Database } from "better-sqlite3";

export type SelectInboundOwnerParams = {
  token_hash: string;
};

export type SelectInboundOwnerResult = {
  user_id: number;
};

export function selectInboundOwner(
  db: Database,
  params: SelectInboundOwnerParams,
): SelectInboundOwnerResult | null {
  const sql = `
	SELECT user_id FROM inbound_tokens WHERE token_hash = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.token_hash]);

  return res ? mapArrayToSelectInboundOwnerResult(res) : null;
}

function mapArrayToSelectInboundOwnerResult(data: any) {
  const result: SelectInboundOwnerResult = {
    user_id: data[0],
  };
  return result;
}
