import type { Database } from "better-sqlite3";

export type InsertTemplateSlotParams = {
  user_id: number | null;
  template_id: number | null;
  position: number | null;
  name: string;
  start_minute: number;
  end_minute: number;
  share_bp: number;
  fill_hint: string | null;
};

export type InsertTemplateSlotResult = {
  changes: number;
  lastInsertRowid: number;
};

export function insertTemplateSlot(
  db: Database,
  params: InsertTemplateSlotParams,
): InsertTemplateSlotResult {
  const sql = `
	INSERT INTO template_slots (user_id, template_id, position, name, start_minute, end_minute, share_bp, fill_hint)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?);
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.template_id,
      params.position,
      params.name,
      params.start_minute,
      params.end_minute,
      params.share_bp,
      params.fill_hint,
    ]) as InsertTemplateSlotResult;
}
