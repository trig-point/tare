import type { Database } from "better-sqlite3";

export type UpsertMovementParams = {
  user_id: number;
  name: string;
  setup: string;
  cues: string;
  mistakes: string;
  safety: string;
  pictures: string;
  rest_seconds: number | null;
  source: string | null;
  equipment: string | null;
  updated_at: string;
};

export type UpsertMovementResult = {
  id: number;
};

export function upsertMovement(
  db: Database,
  params: UpsertMovementParams,
): UpsertMovementResult | null {
  const sql = `
	INSERT INTO movements (user_id, name, setup, cues, mistakes, safety, pictures, rest_seconds, source, equipment, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT (user_id, name COLLATE NOCASE) DO UPDATE SET
	  name = excluded.name, setup = excluded.setup, cues = excluded.cues, mistakes = excluded.mistakes, safety = excluded.safety,
	  pictures = excluded.pictures, rest_seconds = excluded.rest_seconds, source = excluded.source, equipment = excluded.equipment,
	  updated_at = excluded.updated_at
	RETURNING id;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.name,
      params.setup,
      params.cues,
      params.mistakes,
      params.safety,
      params.pictures,
      params.rest_seconds,
      params.source,
      params.equipment,
      params.updated_at,
    ]);

  return res ? mapArrayToUpsertMovementResult(res) : null;
}

function mapArrayToUpsertMovementResult(data: any) {
  const result: UpsertMovementResult = {
    id: data[0],
  };
  return result;
}
