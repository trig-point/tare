import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { applyMigrations, openDatabase } from "../src/db.ts";
import { test } from "./support/hang-ceiling.ts";

test("0010 backfills existing intake dates through the migration runner without replacing metadata", (context) => {
  const connection = openDatabase(":memory:");
  context.after(connection.close);
  const { database } = connection;
  const directory = mkdtempSync(join(tmpdir(), "tare-sign-off-upgrade-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const migrations = new URL("../migrations/", import.meta.url);
  cpSync(migrations, directory, { recursive: true });
  rmSync(join(directory, "0010_day_sign_off_reset.sql"));
  database.pragma("foreign_keys = OFF");
  const tables = database
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all();
  for (const table of tables)
    database.exec(`DROP TABLE "${table.name.replaceAll('"', '""')}"`);
  database.pragma("foreign_keys = ON");
  const folder = pathToFileURL(directory + sep);
  applyMigrations(database, folder);
  database
    .prepare(
      "INSERT INTO users (id, username, timezone, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(1, "example-person", "UTC", "2026-01-01T00:00:00.000Z");
  const insert = database.prepare(
    "INSERT INTO intake_entries (user_id, client_id, name, day, eaten_at, provenance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const [clientId, day] of [
    ["first", "2025-12-30"],
    ["repeat", "2025-12-30"],
    ["second", "2025-12-31"],
  ])
    insert.run(
      1,
      clientId,
      "Example soup",
      day,
      `${day}T12:00:00.000Z`,
      "estimated",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
  database
    .prepare(
      "INSERT INTO days (user_id, day, signed_off_at, notes) VALUES (?, ?, ?, ?)",
    )
    .run(1, "2025-12-30", "2026-01-01T00:00:00.000Z", "Kept");
  cpSync(migrations, directory, { recursive: true });
  applyMigrations(database, folder);
  assert.deepEqual(
    database
      .prepare("SELECT day, signed_off_at, notes FROM days ORDER BY day")
      .all(),
    [
      {
        day: "2025-12-30",
        signed_off_at: "2026-01-01T00:00:00.000Z",
        notes: "Kept",
      },
      { day: "2025-12-31", signed_off_at: null, notes: null },
    ],
  );
  assert.deepEqual(
    database
      .prepare("SELECT name FROM schema_migrations WHERE name = ?")
      .get("0010_day_sign_off_reset.sql"),
    { name: "0010_day_sign_off_reset.sql" },
  );
});
