import type { Database } from "better-sqlite3";

export type ListRecipeLinksParams = {
  user_id: number;
  generation: number;
};

export type ListRecipeLinksResult = {
  recipe_id: number;
  reference_kind: string;
  reference_id: number;
  servings: number;
  desired_servings_at_link: number;
};

export function listRecipeLinks(
  db: Database,
  params: ListRecipeLinksParams,
): ListRecipeLinksResult[] {
  const sql = `
	SELECT recipe_id, reference_kind, reference_id, servings, desired_servings_at_link FROM pantry_recipe_links WHERE user_id = ? AND generation = ? ORDER BY recipe_id;
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([params.user_id, params.generation]);

  return rows.map((data) => mapArrayToListRecipeLinksResult(data));
}

function mapArrayToListRecipeLinksResult(data: any) {
  const result: ListRecipeLinksResult = {
    recipe_id: data[0],
    reference_kind: data[1],
    reference_id: data[2],
    servings: data[3],
    desired_servings_at_link: data[4],
  };
  return result;
}
