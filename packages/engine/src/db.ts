import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export function applyMigrations(
  database: Database.Database,
  migrationsFolder = new URL("../migrations/", import.meta.url),
) {
  database.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY NOT NULL)",
  );
  const names = readdirSync(migrationsFolder)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort((first, second) =>
      first.localeCompare(second, "en", { numeric: true }),
    );
  const applied = database.prepare(
    "SELECT name FROM schema_migrations WHERE name = ?",
  );
  const record = database.prepare(
    "INSERT INTO schema_migrations (name) VALUES (?)",
  );
  for (const name of names) {
    database.transaction(() => {
      if (applied.get(name)) return;
      database.exec(readFileSync(new URL(name, migrationsFolder), "utf8"));
      record.run(name);
    })();
  }
}

export function openDatabase(databaseUrl: string) {
  if (databaseUrl !== ":memory:") {
    mkdirSync(dirname(databaseUrl), { recursive: true });
  }
  const database = new Database(databaseUrl);
  try {
    database.pragma("foreign_keys = ON");
    applyMigrations(database);
    return { database, close: () => database.close() };
  } catch (error) {
    database.close();
    throw error;
  }
}
