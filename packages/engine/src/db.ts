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
  const entries = readdirSync(migrationsFolder);
  const prefixes = new Set<bigint>();
  for (const name of entries) {
    if (
      (/^\d+/.test(name) || name.endsWith(".sql")) &&
      !/^\d+_.+\.sql$/.test(name)
    )
      throw new Error(`Invalid migration filename: ${name}`);
    if (/^\d+_.+\.sql$/.test(name)) {
      const prefix = name.slice(0, name.indexOf("_"));
      const numericPrefix = BigInt(prefix);
      if (prefixes.has(numericPrefix))
        throw new Error(`Duplicate migration prefix: ${prefix}`);
      prefixes.add(numericPrefix);
    }
  }
  const sqlFiles = entries.filter((name) => name.endsWith(".sql"));
  if (sqlFiles.length === 0) throw new Error("No migrations found");
  // Applied history must remain reproducible from the migration files.
  const recorded = database
    .prepare<[], { name: string }>("SELECT name FROM schema_migrations")
    .all();
  for (const migration of recorded) {
    if (!sqlFiles.includes(migration.name))
      throw new Error(`Applied migration file is missing: ${migration.name}`);
  }
  const names = sqlFiles.sort((first, second) =>
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
