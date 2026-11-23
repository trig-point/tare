import type { Database } from "better-sqlite3";

export type SelectBodyScansParams = {
  user_id: number;
};

export type SelectBodyScansResult = {
  id: number;
  day: string;
  method: string;
  total_mass_kg: number;
  body_fat_pct: number;
  fat_mass_kg: number;
  lean_mass_kg: number;
  bone_mineral_kg: number;
  arms_fat_pct: number | null;
  arms_lean_kg: number | null;
  legs_fat_pct: number | null;
  legs_lean_kg: number | null;
  trunk_fat_pct: number | null;
  trunk_lean_kg: number | null;
  android_fat_pct: number | null;
  android_lean_kg: number | null;
  gynoid_fat_pct: number | null;
  gynoid_lean_kg: number | null;
  bone_density_g_cm2: number | null;
  t_score: number | null;
  note: string | null;
};

export function selectBodyScans(
  db: Database,
  params: SelectBodyScansParams,
): SelectBodyScansResult[] {
  const sql = `
	SELECT id, day, method, total_mass_kg, body_fat_pct, fat_mass_kg, lean_mass_kg, bone_mineral_kg, arms_fat_pct, arms_lean_kg, legs_fat_pct, legs_lean_kg, trunk_fat_pct, trunk_lean_kg, android_fat_pct, android_lean_kg, gynoid_fat_pct, gynoid_lean_kg, bone_density_g_cm2, t_score, note
	FROM body_scans
	WHERE user_id = ?
	ORDER BY day, id;
	
	`;
  const rows = db.prepare(sql).raw(true).all([params.user_id]);

  return rows.map((data) => mapArrayToSelectBodyScansResult(data));
}

function mapArrayToSelectBodyScansResult(data: any) {
  const result: SelectBodyScansResult = {
    id: data[0],
    day: data[1],
    method: data[2],
    total_mass_kg: data[3],
    body_fat_pct: data[4],
    fat_mass_kg: data[5],
    lean_mass_kg: data[6],
    bone_mineral_kg: data[7],
    arms_fat_pct: data[8],
    arms_lean_kg: data[9],
    legs_fat_pct: data[10],
    legs_lean_kg: data[11],
    trunk_fat_pct: data[12],
    trunk_lean_kg: data[13],
    android_fat_pct: data[14],
    android_lean_kg: data[15],
    gynoid_fat_pct: data[16],
    gynoid_lean_kg: data[17],
    bone_density_g_cm2: data[18],
    t_score: data[19],
    note: data[20],
  };
  return result;
}
