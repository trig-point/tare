import type { Database } from "better-sqlite3";

export type InsertBodyScanParams = {
  user_id: number;
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
  created_at: string;
};

export type InsertBodyScanResult = {
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

export function insertBodyScan(
  db: Database,
  params: InsertBodyScanParams,
): InsertBodyScanResult | null {
  const sql = `
	INSERT INTO body_scans (user_id, day, method, total_mass_kg, body_fat_pct, fat_mass_kg, lean_mass_kg, bone_mineral_kg, arms_fat_pct, arms_lean_kg, legs_fat_pct, legs_lean_kg, trunk_fat_pct, trunk_lean_kg, android_fat_pct, android_lean_kg, gynoid_fat_pct, gynoid_lean_kg, bone_density_g_cm2, t_score, note, created_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT (user_id, day, method) DO NOTHING
	RETURNING id, day, method, total_mass_kg, body_fat_pct, fat_mass_kg, lean_mass_kg, bone_mineral_kg, arms_fat_pct, arms_lean_kg, legs_fat_pct, legs_lean_kg, trunk_fat_pct, trunk_lean_kg, android_fat_pct, android_lean_kg, gynoid_fat_pct, gynoid_lean_kg, bone_density_g_cm2, t_score, note;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.day,
      params.method,
      params.total_mass_kg,
      params.body_fat_pct,
      params.fat_mass_kg,
      params.lean_mass_kg,
      params.bone_mineral_kg,
      params.arms_fat_pct,
      params.arms_lean_kg,
      params.legs_fat_pct,
      params.legs_lean_kg,
      params.trunk_fat_pct,
      params.trunk_lean_kg,
      params.android_fat_pct,
      params.android_lean_kg,
      params.gynoid_fat_pct,
      params.gynoid_lean_kg,
      params.bone_density_g_cm2,
      params.t_score,
      params.note,
      params.created_at,
    ]);

  return res ? mapArrayToInsertBodyScanResult(res) : null;
}

function mapArrayToInsertBodyScanResult(data: any) {
  const result: InsertBodyScanResult = {
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
