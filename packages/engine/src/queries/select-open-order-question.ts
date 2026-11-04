import type { Database } from "better-sqlite3";

export type SelectOpenOrderQuestionParams = {
  user_id: number;
  subject_ref: string;
  kind: string;
};

export type SelectOpenOrderQuestionResult = {
  id: number;
};

export function selectOpenOrderQuestion(
  db: Database,
  params: SelectOpenOrderQuestionParams,
): SelectOpenOrderQuestionResult | null {
  const sql = `
	SELECT id FROM questions WHERE user_id = ? AND subject_ref = ?
	AND kind = ? AND status = 'open' LIMIT 1;
	
	`;
  const res = db
    .prepare(sql)
    .raw(true)
    .get([params.user_id, params.subject_ref, params.kind]);

  return res ? mapArrayToSelectOpenOrderQuestionResult(res) : null;
}

function mapArrayToSelectOpenOrderQuestionResult(data: any) {
  const result: SelectOpenOrderQuestionResult = {
    id: data[0],
  };
  return result;
}
