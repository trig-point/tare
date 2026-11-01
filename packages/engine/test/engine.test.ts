import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { applyMigrations, openDatabase } from "../src/db.ts";
import { selectFoundation } from "../src/queries/select-foundation.ts";

const migrations = new URL("../migrations/", import.meta.url);
const realNames = readdirSync(migrations).filter((name) =>
  name.endsWith(".sql"),
);
const nextNumber =
  Math.max(...realNames.map((name) => Number(name.split("_")[0]))) + 1;
const syntheticName = (offset: number, suffix: string) =>
  `${String(nextNumber + offset).padStart(4, "0")}_${suffix}`;

function copyMigrations(directory: string) {
  cpSync(migrations, directory, { recursive: true });
}

describe("engine", () => {
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

  test("config trims a padded database URL", () => {
    assert.equal(
      loadConfig({ DATABASE_URL: "  :memory:  " }).databaseUrl,
      ":memory:",
    );
  });

  for (const port of ["0", "65536", "3000.5", "abc", "", "0x50", "1e3"]) {
    test(`config rejects PORT ${JSON.stringify(port)}`, () => {
      assert.throws(
        () => loadConfig({ DATABASE_URL: ":memory:", PORT: port }),
        /PORT/,
      );
    });
  }

  for (const port of ["8080", "1", "65535"]) {
    test(`config accepts PORT ${port}`, () => {
      assert.equal(
        loadConfig({ DATABASE_URL: ":memory:", PORT: port }).port,
        Number(port),
      );
    });
  }

  test("migration runner rejects an unnumbered SQL file", (context) => {
    const directory = mkdtempSync(join(tmpdir(), "tare-migration-name-"));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    copyMigrations(directory);
    writeFileSync(
      join(directory, "invalid.sql"),
      "CREATE TABLE skipped (id INTEGER);",
    );
    const connection = openDatabase(":memory:");
    try {
      assert.throws(
        () =>
          applyMigrations(connection.database, pathToFileURL(directory + sep)),
        /Invalid migration filename: invalid.sql/,
      );
    } finally {
      connection.close();
    }
  });

  test("migration runner rejects an empty migration folder", (context) => {
    const directory = mkdtempSync(join(tmpdir(), "tare-migration-empty-"));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const connection = openDatabase(":memory:");
    try {
      assert.throws(
        () =>
          applyMigrations(connection.database, pathToFileURL(directory + sep)),
        /No migrations found/,
      );
    } finally {
      connection.close();
    }
  });

  test("migration runner rejects duplicate numeric prefixes", (context) => {
    const directory = mkdtempSync(join(tmpdir(), "tare-migration-duplicate-"));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    copyMigrations(directory);
    writeFileSync(
      join(directory, `0${nextNumber}_first.sql`),
      "CREATE TABLE first_table (id INTEGER);",
    );
    writeFileSync(
      join(directory, `${nextNumber}_second.sql`),
      "CREATE TABLE second_table (id INTEGER);",
    );
    const connection = openDatabase(":memory:");
    try {
      assert.throws(
        () =>
          applyMigrations(connection.database, pathToFileURL(directory + sep)),
        /Duplicate migration prefix/,
      );
    } finally {
      connection.close();
    }
  });

  for (const name of [
    `${nextNumber}_wrong.txt`,
    `${nextNumber}_missing`,
    `${nextNumber}`,
  ]) {
    test(`migration runner rejects migration-like entry ${name}`, (context) => {
      const directory = mkdtempSync(
        join(tmpdir(), "tare-migration-extension-"),
      );
      context.after(() => rmSync(directory, { recursive: true, force: true }));
      copyMigrations(directory);
      writeFileSync(
        join(directory, name),
        "CREATE TABLE skipped (id INTEGER);",
      );
      const connection = openDatabase(":memory:");
      try {
        assert.throws(
          () =>
            applyMigrations(
              connection.database,
              pathToFileURL(directory + sep),
            ),
          { message: `Invalid migration filename: ${name}` },
        );
      } finally {
        connection.close();
      }
    });
  }

  test("migration runner rejects a missing previously applied file", (context) => {
    const directory = mkdtempSync(join(tmpdir(), "tare-migration-history-"));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    copyMigrations(directory);
    const extraMigration = join(directory, syntheticName(0, "extra.sql"));
    writeFileSync(extraMigration, "CREATE TABLE extra (id INTEGER);");
    const connection = openDatabase(":memory:");
    try {
      applyMigrations(connection.database, pathToFileURL(directory + sep));
      rmSync(extraMigration);
      assert.throws(
        () =>
          applyMigrations(connection.database, pathToFileURL(directory + sep)),
        {
          message: `Applied migration file is missing: ${syntheticName(0, "extra.sql")}`,
        },
      );
    } finally {
      connection.close();
    }
  });

  test("generated query returns null for a missing row", () => {
    const connection = openDatabase(":memory:");
    try {
      assert.equal(selectFoundation(connection.database, { id: 999 }), null);
    } finally {
      connection.close();
    }
  });

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
    copyMigrations(directory);
    writeFileSync(
      join(directory, syntheticName(0, "bad.sql")),
      "CREATE TABLE partial (id INTEGER); INVALID SQL;",
    );
    const connection = openDatabase(":memory:");
    try {
      assert.throws(
        () =>
          applyMigrations(connection.database, pathToFileURL(directory + sep)),
        /near "INVALID": syntax error/,
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
          .all(syntheticName(0, "bad.sql")),
        [],
      );
    } finally {
      connection.close();
    }
  });

  test("two migrations apply in numeric order", (context) => {
    const directory = mkdtempSync(join(tmpdir(), "tare-migration-order-"));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    copyMigrations(directory);
    const digits = String(nextNumber).length + 1;
    const createName = `${"9".repeat(digits)}_create.sql`;
    const alterName = `1${"0".repeat(digits)}_alter.sql`;
    writeFileSync(
      join(directory, createName),
      "CREATE TABLE ordering (id INTEGER);",
    );
    writeFileSync(
      join(directory, alterName),
      "ALTER TABLE ordering ADD COLUMN applied INTEGER;",
    );
    const connection = openDatabase(":memory:");
    try {
      applyMigrations(connection.database, pathToFileURL(directory + sep));
      assert.deepEqual(
        connection.database
          .prepare("SELECT name FROM schema_migrations ORDER BY rowid")
          .all()
          .slice(realNames.length),
        [{ name: createName }, { name: alterName }],
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
        connection.database
          .prepare("SELECT name FROM schema_migrations ORDER BY name")
          .all(),
        [...realNames].sort().map((name) => ({ name })),
      );
    } finally {
      connection.close();
    }
  });

  test("editing an applied migration fails and names the file", (context) => {
    const directory = mkdtempSync(join(tmpdir(), "tare-migration-edited-"));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const migrationPath = join(directory, "0001_foundation.sql");
    copyMigrations(directory);
    const connection = openDatabase(":memory:");
    try {
      assert.doesNotThrow(() =>
        applyMigrations(connection.database, pathToFileURL(directory + sep)),
      );
      writeFileSync(
        migrationPath,
        "CREATE TABLE foundation (id INTEGER PRIMARY KEY NOT NULL, changed INTEGER);",
      );
      assert.throws(
        () =>
          applyMigrations(connection.database, pathToFileURL(directory + sep)),
        /Applied migration content changed: 0001_foundation.sql/,
      );
    } finally {
      connection.close();
    }
  });
});
