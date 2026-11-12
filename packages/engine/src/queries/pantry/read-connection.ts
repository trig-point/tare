import type { Database } from "better-sqlite3";

export type ReadConnectionResult = {
  id: number;
  generation: number;
  url: string;
  username: string;
  user_id: number;
  reset_required: number;
  fetch_started_at: string | null;
  last_success_at: string | null;
  error: string | null;
};

export function readConnection(db: Database): ReadConnectionResult | null {
  const sql = `
	SELECT * FROM pantry_connection WHERE id = 1;
	
	`;
  const res = db.prepare(sql).raw(true).get();

  return res ? mapArrayToReadConnectionResult(res) : null;
}

function mapArrayToReadConnectionResult(data: any) {
  const result: ReadConnectionResult = {
    id: data[0],
    generation: data[1],
    url: data[2],
    username: data[3],
    user_id: data[4],
    reset_required: data[5],
    fetch_started_at: data[6],
    last_success_at: data[7],
    error: data[8],
  };
  return result;
}
