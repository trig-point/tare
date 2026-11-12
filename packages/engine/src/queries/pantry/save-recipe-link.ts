import type { Database } from "better-sqlite3";

export type SaveRecipeLinkParams = {
  user_id: number | null;
  generation: number | null;
  recipe_id: number | null;
  reference_kind: string;
  reference_id: number;
  servings: number;
  desired_servings_at_link: number;
};

export type SaveRecipeLinkResult = {
  changes: number;
  lastInsertRowid: number;
};

export function saveRecipeLink(
  db: Database,
  params: SaveRecipeLinkParams,
): SaveRecipeLinkResult {
  const sql = `
	INSERT INTO pantry_recipe_links (user_id, generation, recipe_id, reference_kind, reference_id, servings, desired_servings_at_link)
	VALUES (?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(user_id, generation, recipe_id) DO UPDATE SET reference_kind = excluded.reference_kind, reference_id = excluded.reference_id, servings = excluded.servings, desired_servings_at_link = excluded.desired_servings_at_link;
	
	`;
  return db
    .prepare(sql)
    .run([
      params.user_id,
      params.generation,
      params.recipe_id,
      params.reference_kind,
      params.reference_id,
      params.servings,
      params.desired_servings_at_link,
    ]) as SaveRecipeLinkResult;
}
