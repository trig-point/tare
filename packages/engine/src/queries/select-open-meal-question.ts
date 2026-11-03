import type { Database } from "better-sqlite3";

export type SelectOpenMealQuestionParams = {
  user_id: number;
  meal_key: string;
};

export type SelectOpenMealQuestionResult = {
  id: number;
};

export function selectOpenMealQuestion(
  db: Database,
  params: SelectOpenMealQuestionParams,
): SelectOpenMealQuestionResult | null {
  const sql = `
	SELECT id FROM questions
	WHERE user_id = ? AND kind = 'meal_nutrition'
	  AND subject_ref = ? AND status = 'open'
	LIMIT 1;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.meal_key]);

  return res ? mapArrayToSelectOpenMealQuestionResult(res) : null;
}

function mapArrayToSelectOpenMealQuestionResult(data: any) {
  const result: SelectOpenMealQuestionResult = {
    id: data[0],
  };
  return result;
}
