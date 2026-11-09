import type { Database } from "better-sqlite3";

export type SelectSubjectQuestionParams = {
  subject_ref: string;
};

export type SelectSubjectQuestionResult = {
  id: number;
};

export function selectSubjectQuestion(
  db: Database,
  params: SelectSubjectQuestionParams,
): SelectSubjectQuestionResult | null {
  const sql = `
	SELECT id FROM questions WHERE subject_ref = ? LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.subject_ref]);

  return res ? mapArrayToSelectSubjectQuestionResult(res) : null;
}

function mapArrayToSelectSubjectQuestionResult(data: any) {
  const result: SelectSubjectQuestionResult = {
    id: data[0],
  };
  return result;
}
