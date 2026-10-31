import assert from "node:assert/strict";
import { describe, test } from "node:test";
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
