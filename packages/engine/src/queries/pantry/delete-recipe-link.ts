import type { Database } from "better-sqlite3";

export type DeleteRecipeLinkParams = {
  user_id: number;
  generation: number;
  recipe_id: number;
};

export type DeleteRecipeLinkResult = {
  changes: number;
};

export function deleteRecipeLink(
  db: Database,
  params: DeleteRecipeLinkParams,
): DeleteRecipeLinkResult {
  const sql = `
	DELETE FROM pantry_recipe_links WHERE user_id = ? AND generation = ? AND recipe_id = ?;
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.generation,
      params.recipe_id,
    ]) as DeleteRecipeLinkResult;
}
