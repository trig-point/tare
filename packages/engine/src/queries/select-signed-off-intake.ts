import type { Database } from "better-sqlite3";

export type SelectSignedOffIntakeParams = {
  user_id: number;
};

export type SelectSignedOffIntakeResult = {
  day: string;
  eaten_at: string;
  slot_template_id: number | null;
  slot_position: number | null;
  kcal: number | null;
};

export function selectSignedOffIntake(
  db: Database,
  params: SelectSignedOffIntakeParams,
): SelectSignedOffIntakeResult[] {
  const sql = `
	SELECT intake_entries.day, intake_entries.eaten_at, intake_entries.slot_template_id,
	  intake_entries.slot_position, intake_entries.kcal
	FROM intake_entries
	JOIN days ON days.user_id = intake_entries.user_id AND days.day = intake_entries.day
	WHERE intake_entries.user_id = ? AND days.signed_off_at IS NOT NULL;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id]);

  return rows.map((data) => mapArrayToSelectSignedOffIntakeResult(data));
}

function mapArrayToSelectSignedOffIntakeResult(data: any) {
  const result: SelectSignedOffIntakeResult = {
    day: data[0],
    eaten_at: data[1],
    slot_template_id: data[2],
    slot_position: data[3],
    kcal: data[4],
  };
  return result;
}
