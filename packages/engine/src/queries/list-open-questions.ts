import type { Database } from "better-sqlite3";

export type ListOpenQuestionsParams = {
  actor_id: number;
  actor_is_admin_browser: number;
};

export type ListOpenQuestionsResult = {
  id: number;
  kind: string;
  subject_ref: string;
  prompt: string;
  answer_schema: string;
  created_at: string;
};

export function listOpenQuestions(
  db: Database,
  params: ListOpenQuestionsParams,
): ListOpenQuestionsResult[] {
  const sql = `
	SELECT id, kind, subject_ref, prompt, answer_schema, created_at
	FROM questions
	WHERE (user_id = ? OR (user_id IS NULL AND ? = 1))
	  AND status = 'open'
	ORDER BY id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.actor_id, params.actor_is_admin_browser]);

  return rows.map((data) => mapArrayToListOpenQuestionsResult(data));
}

function mapArrayToListOpenQuestionsResult(data: any) {
  const result: ListOpenQuestionsResult = {
    id: data[0],
    kind: data[1],
    subject_ref: data[2],
    prompt: data[3],
    answer_schema: data[4],
    created_at: data[5],
  };
  return result;
}
