import type { Database } from "better-sqlite3";

export type AnswerQuestionData = {
  answer: string | null;
  answered_at: string | null;
};

export type AnswerQuestionParams = {
  actor_id: number;
  actor_is_admin_browser: number;
  id: number;
};

export type AnswerQuestionResult = {
  id: number;
};

export function answerQuestion(
  db: Database,
  data: AnswerQuestionData,
  params: AnswerQuestionParams,
): AnswerQuestionResult[] {
  const sql = `
	UPDATE questions SET status = 'answered', answer = ?, answered_at = ?
	WHERE (user_id = ? OR (user_id IS NULL AND ? = 1))
	  AND id = ? AND status = 'open'
	RETURNING id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      data.answer,
      data.answered_at,
      params.actor_id,
      params.actor_is_admin_browser,
      params.id,
    ]);

  return rows.map((data) => mapArrayToAnswerQuestionResult(data));
}

function mapArrayToAnswerQuestionResult(data: any) {
  const result: AnswerQuestionResult = {
    id: data[0],
  };
  return result;
}
