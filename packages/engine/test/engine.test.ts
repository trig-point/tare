import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { applyMigrations, openDatabase } from "../src/db.ts";
import { selectFoundation } from "../src/queries/select-foundation.ts";

describe("engine foundation", () => {
  test("health returns 200 and ok", async () => {
    const response = await createApp().request("/health");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });

  test("config rejects a missing required variable by name", () => {
    assert.throws(() => loadConfig({}), /DATABASE_URL is required/);
  });

  test("config reads a present required variable and defaults the port", () => {
    assert.deepEqual(loadConfig({ DATABASE_URL: ":memory:" }), {
      databaseUrl: ":memory:",
      port: 3000,
    });
  });

  for (const port of ["0", "65536", "3000.5", "abc", "", "0x50", "1e3"]) {
    test(`config rejects PORT ${JSON.stringify(port)}`, () => {
      assert.throws(
        () => loadConfig({ DATABASE_URL: ":memory:", PORT: port }),
        /PORT/,
      );
    });
  }

  test("config rejects a blank database URL", () => {
    assert.throws(
      () => loadConfig({ DATABASE_URL: "   " }),
      /DATABASE_URL is required/,
    );
  });

  test("database enables foreign keys", () => {
    const connection = openDatabase(":memory:");
    try {
      assert.equal(
        connection.database.pragma("foreign_keys", { simple: true }),
        1,
      );
    } finally {
      connection.close();
    }
  });

  test("a failing migration rolls back DDL and is not recorded", (context) => {
    const directory = mkdtempSync(join(tmpdir(), "tare-migration-failure-"));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(
      join(directory, "0002_bad.sql"),
      "CREATE TABLE partial (id INTEGER); INVALID SQL;",
    );
    const connection = openDatabase(":memory:");
    try {
      assert.throws(() =>
        applyMigrations(connection.database, pathToFileURL(directory + sep)),
      );
      assert.deepEqual(
        connection.database
          .prepare("SELECT name FROM sqlite_master WHERE name = ?")
          .all("partial"),
        [],
      );
      assert.deepEqual(
        connection.database
          .prepare("SELECT name FROM schema_migrations WHERE name = ?")
          .all("0002_bad.sql"),
        [],
      );
    } finally {
      connection.close();
    }
  });

  test("two migrations apply in numeric order", (context) => {
    const directory = mkdtempSync(join(tmpdir(), "tare-migration-order-"));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(
      join(directory, "2_create.sql"),
      "CREATE TABLE ordering (id INTEGER);",
    );
    writeFileSync(
      join(directory, "10_alter.sql"),
      "ALTER TABLE ordering ADD COLUMN applied INTEGER;",
    );
    const connection = openDatabase(":memory:");
    try {
      applyMigrations(connection.database, pathToFileURL(directory + sep));
      assert.deepEqual(
        connection.database
          .prepare(
            "SELECT name FROM schema_migrations WHERE name != ? ORDER BY rowid",
          )
          .all("0001_foundation.sql"),
        [{ name: "2_create.sql" }, { name: "10_alter.sql" }],
      );
      connection.database
        .prepare("INSERT INTO ordering (id, applied) VALUES (?, ?)")
        .run(1, 1);
      assert.deepEqual(
        connection.database.prepare("SELECT id, applied FROM ordering").all(),
        [{ id: 1, applied: 1 }],
      );
    } finally {
      connection.close();
    }
  });

  test("file database creates its missing parent directory", (context) => {
    const directory = mkdtempSync(join(tmpdir(), "tare-file-db-"));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const databasePath = join(directory, "missing", "engine.sqlite");
    const connection = openDatabase(databasePath);
    try {
      assert.equal(existsSync(databasePath), true);
      connection.database
        .prepare("INSERT INTO foundation (id) VALUES (?)")
        .run(3);
      assert.deepEqual(selectFoundation(connection.database, { id: 3 }), {
        id: 3,
      });
    } finally {
      connection.close();
    }
  });

  test("migrations create the foundation table and generated query reads it", () => {
    const connection = openDatabase(":memory:");
    try {
      connection.database
        .prepare("INSERT INTO foundation (id) VALUES (?)")
        .run(1);
      assert.deepEqual(selectFoundation(connection.database, { id: 1 }), {
        id: 1,
      });
    } finally {
      connection.close();
    }
  });

  test("applying migrations twice preserves data and records the migration once", () => {
    const connection = openDatabase(":memory:");
    try {
      connection.database
        .prepare("INSERT INTO foundation (id) VALUES (?)")
        .run(2);
      applyMigrations(connection.database);
      assert.deepEqual(selectFoundation(connection.database, { id: 2 }), {
        id: 2,
      });
      assert.deepEqual(
        connection.database.prepare("SELECT name FROM schema_migrations").all(),
        [{ name: "0001_foundation.sql" }],
      );
    } finally {
      connection.close();
    }
  });
});
