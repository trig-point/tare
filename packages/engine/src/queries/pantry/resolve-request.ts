import type { Database } from "better-sqlite3";

export type ResolveRequestData = {
  state: string | null;
  now: string | null;
};

export type ResolveRequestParams = {
  id: string;
  expected: string;
  number: number;
};

export type ResolveRequestResult = {
  id: string;
};

export function resolveRequest(
  db: Database,
  data: ResolveRequestData,
  params: ResolveRequestParams,
): ResolveRequestResult[] {
  const sql = `
	UPDATE pantry_requests SET state = ?, updated_at = ?,
	  reason = CASE WHEN ? = 'pending' THEN NULL ELSE reason END,
	  uncertain_since = CASE WHEN ? = 'pending' THEN NULL ELSE uncertain_since END,
	  resolved_at = CASE WHEN ? = 'pending' THEN resolved_at ELSE ? END
	WHERE id = ? AND state = ? AND attempt_count = ? RETURNING id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      data.state,
      data.now,
      data.state,
      data.state,
      data.state,
      data.now,
      params.id,
      params.expected,
      params.number,
    ]);

  return rows.map((data) => mapArrayToResolveRequestResult(data));
}

function mapArrayToResolveRequestResult(data: any) {
  const result: ResolveRequestResult = {
    id: data[0],
  };
  return result;
}
