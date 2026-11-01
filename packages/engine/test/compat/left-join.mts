import { readFileSync } from "node:fs";
import type { Database } from "better-sqlite3";

const sql = readFileSync(new URL("./left-join.sql", import.meta.url), "utf8");
export function leftJoin(
  database: Database,
): { id: number; name: string | null }[] {
  return database.prepare(sql).all() as { id: number; name: string | null }[];
}
