import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { applyMigrations, openDatabase } from "../src/db.ts";
import { insertSession } from "../src/queries/insert-session.ts";
import { fixture } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";

test("session migration upgrades the prior schema and enforces expiry, ownership and cascade", (context) => {
  const setup = fixture(context);
  const directory = mkdtempSync(join(tmpdir(), "tare-session-migration-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const folder = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(folder).filter((name) =>
    /^000[123]_/.test(name),
  ))
    cpSync(new URL(name, folder), join(directory, name));
  const connection = openDatabase(":memory:");
  context.after(connection.close);
  connection.database.exec(
    "DROP TABLE sessions; DELETE FROM schema_migrations WHERE name = '0004_sessions.sql'",
  );
  applyMigrations(connection.database, pathToFileURL(directory + sep));
  applyMigrations(connection.database);
  assert.ok(
    connection.database
      .prepare("SELECT name FROM sqlite_master WHERE name = 'sessions'")
      .get(),
  );
  const session = {
    token_hash: "made-up-digest",
    user_id: setup.admin.id,
    created_at: "2026-01-01T00:00:00.000Z",
    expires_at: "2026-01-02T00:00:00.000Z",
  };
  for (const expires_at of [
    session.created_at,
    "2025-12-31T00:00:00.000Z",
    "not-a-date",
  ])
    assert.throws(
      () => insertSession(setup.database, { ...session, expires_at }),
      /CHECK constraint/,
    );
  assert.throws(
    () => insertSession(setup.database, { ...session, user_id: 999 }),
    /FOREIGN KEY/,
  );
  insertSession(setup.database, session);
  setup.database.prepare("DELETE FROM users WHERE id = ?").run(setup.admin.id);
  assert.deepEqual(setup.rows(), []);
});
