import type { Database } from "better-sqlite3";

export type AbandonRequestData = {
  now: string;
};

export type AbandonRequestParams = {
  id: number;
};

export type AbandonRequestResult = {
  id: number;
};

export function abandonRequest(
  db: Database,
  data: AbandonRequestData,
  params: AbandonRequestParams,
): AbandonRequestResult[] {
  const sql = `
	UPDATE grocery_requests SET state = 'abandoned', updated_at = ?
	WHERE id = ? AND state IN ('open', 'binding_pending') AND NOT EXISTS (SELECT 1 FROM grocery_steps WHERE request_id = ? AND state = 'sending')
	RETURNING id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([data.now, params.id, params.id]);

  return rows.map((data) => mapArrayToAbandonRequestResult(data));
}

function mapArrayToAbandonRequestResult(data: any) {
  const result: AbandonRequestResult = {
    id: data[0],
  };
  return result;
}
