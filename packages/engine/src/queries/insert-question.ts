import type { Database } from "better-sqlite3";

export type InsertQuestionParams = {
  user_id: number | null;
  kind: string;
  subject_ref: string;
  prompt: string;
  answer_schema: string;
  created_at: string;
};

export type InsertQuestionResult = {
  id: number;
  user_id: number | null;
  kind: string;
  subject_ref: string;
  prompt: string;
  answer_schema: string;
  status: string;
  answer: string | null;
  created_at: string;
  answered_at: string | null;
};

export function insertQuestion(
  db: Database,
  params: InsertQuestionParams,
): InsertQuestionResult | null {
  const sql = `
	INSERT INTO questions (user_id, kind, subject_ref, prompt, answer_schema, status, created_at)
	VALUES (?, ?, ?, ?, ?, 'open', ?)
	RETURNING *;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([
      params.user_id,
      params.kind,
      params.subject_ref,
      params.prompt,
      params.answer_schema,
      params.created_at,
    ]);

  return res ? mapArrayToInsertQuestionResult(res) : null;
}

function mapArrayToInsertQuestionResult(data: any) {
  const result: InsertQuestionResult = {
    id: data[0],
    user_id: data[1],
    kind: data[2],
    subject_ref: data[3],
    prompt: data[4],
    answer_schema: data[5],
    status: data[6],
    answer: data[7],
    created_at: data[8],
    answered_at: data[9],
  };
  return result;
}
