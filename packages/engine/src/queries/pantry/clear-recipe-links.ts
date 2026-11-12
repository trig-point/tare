import type { Database } from "better-sqlite3";

export type ClearRecipeLinksResult = {
  changes: number;
};

export function clearRecipeLinks(db: Database): ClearRecipeLinksResult {
  const sql = `
	DELETE FROM pantry_recipe_links;
	
	`;
  return db.prepare(sql).run() as ClearRecipeLinksResult;
}
