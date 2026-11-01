import { readFileSync } from "node:fs";
import type { Database } from "better-sqlite3";

const sql = readFileSync(
  new URL("../../../test/fixtures/compat-json.sql", import.meta.url),
  "utf8",
);
export function json(
  database: Database,
  document: string | null,
): { name: unknown } {
  return database.prepare(sql).get({ document }) as { name: unknown };
}
