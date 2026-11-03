import type { Database } from "better-sqlite3";

export type SelectQuestionParams = {
  actor_id: number;
  actor_is_admin_browser: number;
  id: number;
};

export type SelectQuestionResult = {
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

export function selectQuestion(
  db: Database,
  params: SelectQuestionParams,
): SelectQuestionResult | null {
  const sql = `
	SELECT * FROM questions
	WHERE (user_id = ? OR (user_id IS NULL AND ? = 1))
	  AND id = ? LIMIT 1;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.actor_id, params.actor_is_admin_browser, params.id]);

  return res ? mapArrayToSelectQuestionResult(res) : null;
}

function mapArrayToSelectQuestionResult(data: any) {
  const result: SelectQuestionResult = {
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
