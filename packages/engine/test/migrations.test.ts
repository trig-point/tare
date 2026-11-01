import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { type TestContext, test } from "node:test";
import { pathToFileURL } from "node:url";
import { applyMigrations, openDatabase } from "../src/db.ts";

const migrations = new URL("../migrations/", import.meta.url);
const nextNumber =
  Math.max(
    ...readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => Number(name.split("_")[0])),
  ) + 1;
const pendingName = (suffix: string) =>
  `${String(nextNumber + 1).padStart(4, "0")}_${suffix}`;

function fixture(context: TestContext, persistent = false) {
  const directory = mkdtempSync(join(tmpdir(), "tare-rebuild-"));
  const connection = openDatabase(
    persistent ? join(directory, "race.sqlite") : ":memory:",
  );
  const other = persistent
    ? openDatabase(join(directory, "race.sqlite"))
    : undefined;
  context.after(() => {
    other?.close();
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });
  cpSync(migrations, directory, { recursive: true });
  writeFileSync(
    join(directory, `${String(nextNumber).padStart(4, "0")}_seed.sql`),
    `
    CREATE TABLE parent (id INTEGER PRIMARY KEY, label TEXT);
    CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));
    INSERT INTO parent VALUES (1, 'Sample');
    INSERT INTO child VALUES (1, 1);
  `,
  );
  const folder = pathToFileURL(directory + sep);
  applyMigrations(connection.database, folder);
  return { database: connection.database, directory, folder, other };
}

const rebuild = `-- tare:rebuild
CREATE TABLE replacement (id INTEGER PRIMARY KEY, label TEXT, added TEXT);
INSERT INTO replacement (id, label) SELECT id, label FROM parent;
DROP TABLE parent;
ALTER TABLE replacement RENAME TO parent;
`;

test("orphaned rebuild rolls back schema, rows and record and restores foreign keys", (context) => {
  const { database, directory, folder } = fixture(context);
  const before = database
    .prepare("SELECT name, sql FROM sqlite_schema ORDER BY name")
    .all();
  writeFileSync(
    join(directory, pendingName("rebuild.sql")),
    `${rebuild}DELETE FROM parent;`,
  );
  assert.throws(() => applyMigrations(database, folder), /rebuild.sql.*child/);
  assert.deepEqual(
    database.prepare("SELECT name, sql FROM sqlite_schema ORDER BY name").all(),
    before,
  );
  assert.deepEqual(database.prepare("SELECT * FROM parent").all(), [
    { id: 1, label: "Sample" },
  ]);
  assert.deepEqual(database.prepare("SELECT * FROM child").all(), [
    { id: 1, parent_id: 1 },
  ]);
  assert.equal(
    database
      .prepare("SELECT name FROM schema_migrations WHERE name = ?")
      .get(pendingName("rebuild.sql")),
    undefined,
  );
  assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
});

test("clean rebuild preserves populated rows and restores foreign keys", (context) => {
  const { database, directory, folder } = fixture(context);
  writeFileSync(join(directory, pendingName("rebuild.sql")), rebuild);
  applyMigrations(database, folder);
  assert.deepEqual(database.prepare("SELECT * FROM parent").all(), [
    { id: 1, label: "Sample", added: null },
  ]);
  assert.deepEqual(database.prepare("SELECT * FROM child").all(), [
    { id: 1, parent_id: 1 },
  ]);
  assert.deepEqual(database.pragma("foreign_key_check"), []);
  assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
  const changes = database.prepare("SELECT total_changes() AS count").get();
  applyMigrations(database, folder);
  assert.deepEqual(
    database.prepare("SELECT total_changes() AS count").get(),
    changes,
  );
});

test("fresh database replays every real migration and second run is a no-op", (context) => {
  const connection = openDatabase(":memory:");
  context.after(connection.close);
  const files = readdirSync(new URL("../migrations/", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.ok(files.length > 0);
  const recorded = () =>
    connection.database
      .prepare("SELECT name, content_hash FROM schema_migrations ORDER BY name")
      .all() as { name: string; content_hash: string }[];
  const before = recorded();
  assert.deepEqual(
    before.map((row) => row.name),
    files,
  );
  assert.ok(before.every((row) => row.content_hash.length === 64));
  const changes = connection.database
    .prepare("SELECT total_changes() AS count")
    .get();
  applyMigrations(connection.database);
  assert.deepEqual(recorded(), before);
  assert.deepEqual(
    connection.database.prepare("SELECT total_changes() AS count").get(),
    changes,
  );
});

test("unmarked migration rolls back the whole file on statement failure", (context) => {
  const { database, directory, folder } = fixture(context);
  writeFileSync(
    join(directory, pendingName("bad.sql")),
    "CREATE TABLE partial (id INTEGER); INSERT INTO parent VALUES (2, 'Other'); INVALID SQL;",
  );
  assert.throws(() => applyMigrations(database, folder), /syntax error/);
  assert.equal(
    database
      .prepare("SELECT name FROM sqlite_schema WHERE name = ?")
      .get("partial"),
    undefined,
  );
  assert.deepEqual(database.prepare("SELECT * FROM parent").all(), [
    { id: 1, label: "Sample" },
  ]);
  assert.equal(
    database
      .prepare("SELECT name FROM schema_migrations WHERE name = ?")
      .get(pendingName("bad.sql")),
    undefined,
  );
  assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
});

test("malformed rebuild rolls back and restores foreign keys", (context) => {
  const { database, directory, folder } = fixture(context);
  writeFileSync(
    join(directory, pendingName("bad.sql")),
    `${rebuild}INVALID SQL;`,
  );
  assert.throws(() => applyMigrations(database, folder), /syntax error/);
  assert.deepEqual(database.prepare("SELECT * FROM parent").all(), [
    { id: 1, label: "Sample" },
  ]);
  assert.equal(
    database
      .prepare("SELECT name FROM schema_migrations WHERE name = ?")
      .get(pendingName("bad.sql")),
    undefined,
  );
  assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
});

for (const marked of [false, true]) {
  test(`concurrent application is rechecked inside the transaction (rebuild=${marked})`, (context) => {
    const { database, directory, folder, other } = fixture(context, true);
    assert.ok(other);
    writeFileSync(
      join(directory, pendingName("race.sql")),
      marked ? rebuild : "CREATE TABLE raced (id INTEGER);",
    );
    const original = database.transaction.bind(database);
    let interleaved = false;
    context.mock.method(database, "transaction", (callback: () => unknown) => {
      if (!interleaved) {
        interleaved = true;
        applyMigrations(other.database, folder);
      }
      return original(callback);
    });
    assert.doesNotThrow(() => applyMigrations(database, folder));
    assert.equal(interleaved, true);
    assert.deepEqual(
      database
        .prepare("SELECT name FROM schema_migrations WHERE name = ?")
        .all(pendingName("race.sql")),
      [{ name: pendingName("race.sql") }],
    );
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
  });
}

for (const marker of [
  "\uFEFF-- tare:rebuild",
  "-- tare:rebuild\r",
  "  -- tare:rebuild  ",
]) {
  test(`normalized rebuild marker ${JSON.stringify(marker)} preserves rows`, (context) => {
    const { database, directory, folder } = fixture(context);
    writeFileSync(
      join(directory, pendingName("marker.sql")),
      rebuild.replace("-- tare:rebuild", marker),
    );
    assert.doesNotThrow(() => applyMigrations(database, folder));
    assert.deepEqual(database.prepare("SELECT * FROM parent").all(), [
      { id: 1, label: "Sample", added: null },
    ]);
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
  });
}

for (const marker of [
  "--tare:rebuild",
  "-- TARE:REBUILD",
  "-- tare:rebuild extra",
]) {
  test(`malformed rebuild marker ${marker} names the file`, (context) => {
    const { database, directory, folder } = fixture(context);
    writeFileSync(
      join(directory, pendingName("marker.sql")),
      `${marker}\nCREATE TABLE skipped_marker (id INTEGER);`,
    );
    assert.throws(
      () => applyMigrations(database, folder),
      /Invalid rebuild marker.*marker.sql/,
    );
    assert.equal(
      database
        .prepare("SELECT name FROM sqlite_schema WHERE name = ?")
        .get("skipped_marker"),
      undefined,
    );
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
  });
}

test("a rebuild marker on line two keeps ordinary foreign-key enforcement", (context) => {
  const { database, directory, folder } = fixture(context);
  writeFileSync(join(directory, pendingName("marker.sql")), `\n${rebuild}`);
  assert.throws(
    () => applyMigrations(database, folder),
    /FOREIGN KEY constraint failed/,
  );
  assert.deepEqual(database.prepare("SELECT * FROM parent").all(), [
    { id: 1, label: "Sample" },
  ]);
  assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
});

test("pending rebuild inside a caller transaction fails naming the file", (context) => {
  const { database, directory, folder } = fixture(context);
  writeFileSync(join(directory, pendingName("nested.sql")), rebuild);
  database.transaction(() => {
    assert.throws(
      () => applyMigrations(database, folder),
      /nested.sql.*inside.*transaction/,
    );
    assert.equal(database.inTransaction, true);
    assert.deepEqual(database.prepare("SELECT * FROM parent").all(), [
      { id: 1, label: "Sample" },
    ]);
    assert.equal(
      database
        .prepare("SELECT name FROM schema_migrations WHERE name = ?")
        .get(pendingName("nested.sql")),
      undefined,
    );
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
  })();
});

test("clean rebuild restores disabled foreign-key enforcement", (context) => {
  const { database, directory, folder } = fixture(context);
  database.pragma("foreign_keys = OFF");
  writeFileSync(join(directory, pendingName("disabled.sql")), rebuild);
  applyMigrations(database, folder);
  assert.deepEqual(database.prepare("SELECT * FROM parent").all(), [
    { id: 1, label: "Sample", added: null },
  ]);
  assert.equal(database.pragma("foreign_keys", { simple: true }), 0);
});
