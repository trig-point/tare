import type { Database } from "better-sqlite3";

export type ListActivityEventsAfterParams = {
  user_id: number;
  after_id: number;
};

export type ListActivityEventsAfterResult = {
  id: number;
  kind: string;
  dose_status: string | null;
  food_name: string | null;
  kcal: number | null;
  protein_g: number | null;
  slot: string | null;
  weight_kg: number | null;
  workout_kind: string | null;
  duration_minutes: number | null;
  medication: string | null;
};

export function listActivityEventsAfter(
  db: Database,
  params: ListActivityEventsAfterParams,
): ListActivityEventsAfterResult[] {
  const sql = `
	SELECT event.id, event.kind, event.dose_status, intake.name AS food_name, intake.kcal, intake.protein_g,
	  slot.name AS slot, weight.weight_kg, session.kind AS workout_kind, session.duration_minutes,
	  medication.name AS medication
	FROM activity_events event
	LEFT JOIN intake_entries intake ON event.kind = 'food' AND intake.id = event.record_id
	LEFT JOIN template_slots slot ON slot.user_id = intake.user_id
	  AND slot.template_id = intake.slot_template_id AND slot.position = intake.slot_position
	LEFT JOIN weights weight ON event.kind = 'weight' AND weight.id = event.record_id
	LEFT JOIN activity_sessions session ON event.kind = 'workout' AND session.id = event.record_id
	LEFT JOIN medication_doses dose ON event.kind = 'dose' AND dose.id = event.record_id
	LEFT JOIN medications medication ON medication.id = dose.medication_id
	WHERE (event.user_id = ? OR event.user_id IS NULL) AND event.id > ? ORDER BY event.id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id, params.after_id]);

  return rows.map((data) => mapArrayToListActivityEventsAfterResult(data));
}

function mapArrayToListActivityEventsAfterResult(data: any) {
  const result: ListActivityEventsAfterResult = {
    id: data[0],
    kind: data[1],
    dose_status: data[2],
    food_name: data[3],
    kcal: data[4],
    protein_g: data[5],
    slot: data[6],
    weight_kg: data[7],
    workout_kind: data[8],
    duration_minutes: data[9],
    medication: data[10],
  };
  return result;
}
