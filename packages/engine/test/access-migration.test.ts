import assert from "node:assert/strict";
import { applyMigrations, openDatabase } from "../src/db.ts";
import { insertAccount } from "../src/queries/insert-account.ts";
import { insertSession } from "../src/queries/insert-session.ts";
import { selectSessionUser } from "../src/queries/select-session-user.ts";
import { selectUser } from "../src/queries/select-user.ts";
import { test } from "./support/hang-ceiling.ts";

test("Access rebuild preserves every user field, child row, session and foreign key", (context) => {
  const { database, close } = openDatabase(":memory:");
  context.after(close);
  database.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TABLE users;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      timezone TEXT NOT NULL, day_start_hour INTEGER NOT NULL DEFAULT 4 CHECK (day_start_hour BETWEEN 0 AND 23),
      is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
      created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at)
    ) STRICT;
    DELETE FROM schema_migrations WHERE name = '0005_access_identity.sql';
    PRAGMA foreign_keys = ON;
  `);
  const timestamp = "2026-01-01T00:00:00.000Z";
  database
    .prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(41, "example-admin", "invented-hash", "UTC", 7, 1, timestamp);
  database
    .prepare(
      "INSERT INTO foods (user_id, id, name, provenance) VALUES (?, ?, ?, ?)",
    )
    .run(41, 12, "Example meal", "estimated");
  database
    .prepare(
      "INSERT INTO intake_entries (user_id, client_id, food_id, eaten_at, day, provenance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      41,
      "example-entry",
      12,
      timestamp,
      "2026-01-01",
      "estimated",
      timestamp,
      timestamp,
    );
  database
    .prepare(
      "INSERT INTO weights (user_id, client_id, measured_at, day, weight_kg, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(41, "example-weight", timestamp, "2026-01-01", 70, timestamp);
  database
    .prepare("INSERT INTO days (user_id, day) VALUES (?, ?)")
    .run(41, "2026-01-01");
  insertSession(database, {
    token_hash: "example-token-digest",
    user_id: 41,
    created_at: timestamp,
    expires_at: "2026-01-02T00:00:00.000Z",
  });
  const tables = [
    "users",
    "foods",
    "intake_entries",
    "weights",
    "days",
    "sessions",
  ];
  const before = tables.map((table) =>
    database.prepare(`SELECT * FROM ${table}`).all(),
  );
  applyMigrations(database);
  assert.deepEqual(selectUser(database, { id: 41 }), {
    ...(before[0]?.[0] as object),
    access_email: null,
  });
  for (const [offset, table] of tables.slice(1).entries())
    assert.deepEqual(
      database.prepare(`SELECT * FROM ${table}`).all(),
      before[offset + 1],
    );
  assert.equal(
    selectSessionUser(database, {
      token_hash: "example-token-digest",
      now: timestamp,
    })?.id,
    41,
  );
  assert.deepEqual(database.pragma("foreign_key_check"), []);
  assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
  const account = {
    username: "access-example",
    password_hash: null,
    access_email: "admin@example.com",
    timezone: "UTC",
    is_admin: 0,
    created_at: timestamp,
  };
  assert.ok(insertAccount(database, account));
  assert.throws(
    () =>
      insertAccount(database, { ...account, username: "duplicate-example" }),
    /UNIQUE/,
  );
  for (const username of ["fallback-one", "fallback-two"])
    assert.ok(
      insertAccount(database, { ...account, username, access_email: null }),
    );
  database.prepare("DELETE FROM sessions WHERE user_id = ?").run(41);
  assert.throws(
    () => database.prepare("DELETE FROM users WHERE id = ?").run(41),
    /FOREIGN KEY/,
  );
});
