import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export function applyMigrations(
  database: Database.Database,
  migrationsFolder = new URL("../migrations/", import.meta.url),
) {
  database.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY NOT NULL, content_hash TEXT NOT NULL)",
  );
  const columns = database.pragma("table_info(schema_migrations)") as {
    name: string;
  }[];
  if (!columns.some((column) => column.name === "content_hash")) {
    database.exec("ALTER TABLE schema_migrations ADD COLUMN content_hash TEXT");
  }
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
  const migrations = sqlFiles
    .sort((first, second) =>
      first.localeCompare(second, "en", { numeric: true }),
    )
    .map((name) => {
      const content = readFileSync(new URL(name, migrationsFolder));
      return {
        name,
        content: content.toString("utf8"),
        hash: createHash("sha256").update(content).digest("hex"),
      };
    });
  // Stored hashes prevent edited files from silently changing applied history.
  const recorded = database
    .prepare<[], { name: string; content_hash: string | null }>(
      "SELECT name, content_hash FROM schema_migrations",
    )
    .all();
  for (const migration of recorded) {
    const file = migrations.find((file) => file.name === migration.name);
    if (!file)
      throw new Error(`Applied migration file is missing: ${migration.name}`);
    if (migration.content_hash === null)
      throw new Error(`Applied migration hash is missing: ${migration.name}`);
    if (migration.content_hash !== file.hash)
      throw new Error(`Applied migration content changed: ${migration.name}`);
  }
  const applied = database.prepare(
    "SELECT name FROM schema_migrations WHERE name = ?",
  );
  const record = database.prepare(
    "INSERT INTO schema_migrations (name, content_hash) VALUES (?, ?)",
  );
  for (const { name, content, hash } of migrations) {
    database.transaction(() => {
      if (applied.get(name)) return;
      database.exec(content);
      record.run(name, hash);
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

import { createHash } from "node:crypto";
