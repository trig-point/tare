import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export function applyMigrations(database: Database.Database) {
  database.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY NOT NULL)",
  );
  const migrationsFolder = new URL("../migrations/", import.meta.url);
  const names = readdirSync(migrationsFolder)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
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
    applyMigrations(database);
    return { database, close: () => database.close() };
  } catch (error) {
    database.close();
    throw error;
  }
}
