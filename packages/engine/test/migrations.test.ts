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
import Database from "better-sqlite3";
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
  assert.throws(
    () => applyMigrations(database, folder),
    new RegExp(`${pendingName("rebuild.sql").replaceAll(".", "\\.")}.*child`),
  );
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
      new RegExp(
        `Invalid rebuild marker.*${pendingName("marker.sql").replaceAll(".", "\\.")}`,
      ),
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
      new RegExp(
        `${pendingName("nested.sql").replaceAll(".", "\\.")}.*inside.*transaction`,
      ),
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

test("0028 and 0042 keep stored signals, allow water and reject unknown metrics", (context) => {
  const { database, folder } = fixture(context);
  database.exec(`DELETE FROM schema_migrations WHERE name IN ('0028_oura_daily_scores.sql', '0042_water_signal.sql');
    ALTER TABLE oura_connections DROP COLUMN scores_backfilled_at;
    INSERT INTO users (id, username, timezone, created_at) VALUES (1, 'example-person', 'UTC', '2026-01-01T00:00:00.000Z');
    INSERT INTO daily_signals VALUES (1, '2026-01-01', 'readiness', 80, 'oura', '2026-01-01T00:00:00.000Z');`);
  applyMigrations(database, folder);
  const insert = database.prepare(
    "INSERT INTO daily_signals VALUES (1, '2026-01-01', ?, 1, 'oura', '2026-01-01T00:00:00.000Z')",
  );
  insert.run("stress_summary");
  insert.run("water");
  assert.throws(() => insert.run("unknown"), /CHECK constraint/);
  assert.deepEqual(
    database.prepare("SELECT * FROM daily_signals ORDER BY metric").raw().all(),
    ["readiness", "stress_summary", "water"].map((metric, index) => [
      ...[1, "2026-01-01", metric, index ? 1 : 80, "oura"],
      "2026-01-01T00:00:00.000Z",
    ]),
  );
});

test("0030 keeps every stored session and its keys", (context) => {
  const folder = mkdtempSync(join(tmpdir(), "tare-0030-"));
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  context.after(() => {
    database.close();
    rmSync(folder, { recursive: true, force: true });
  });
  const copy = (upTo: number) => {
    for (const name of readdirSync(migrations).filter(
      (name) => name.endsWith(".sql") && Number(name.split("_")[0]) <= upTo,
    ))
      cpSync(new URL(name, migrations), join(folder, name));
  };
  copy(29);
  applyMigrations(database, pathToFileURL(folder + sep));
  database.exec(`INSERT INTO users (id, username, timezone, created_at) VALUES (1, 'example-person', 'UTC', '2026-01-01T00:00:00.000Z');
    INSERT INTO activity_sessions VALUES (7, 1, 'example-client', '2026-01-01T06:00:00.000Z', '2026-01-01', 30, 'run', 210, 'oura', 'example-record', '2026-01-01T07:00:00.000Z');`);
  const sessions = () =>
    database
      .prepare(
        "SELECT id, user_id, client_id, started_at, day, duration_minutes, kind, calories, source, source_record_id, created_at FROM activity_sessions",
      )
      .all();
  const before = sessions();
  copy(30);
  applyMigrations(database, pathToFileURL(folder + sep));
  assert.deepEqual(sessions(), before);
  assert.throws(
    () =>
      database.exec(
        "INSERT INTO activity_sessions (user_id, client_id, started_at, day, duration_minutes, kind, source, created_at) VALUES (1, 'example-client', '2026-01-02T06:00:00.000Z', '2026-01-02', 20, 'walk', 'manual', '2026-01-02T07:00:00.000Z')",
      ),
    /UNIQUE/,
  );
});

test("0038 numbers earlier local rejections and dates earlier deliveries", (context) => {
  const folder = mkdtempSync(join(tmpdir(), "tare-0038-"));
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  context.after(() => {
    database.close();
    rmSync(folder, { recursive: true, force: true });
  });
  const copy = (upTo: number) => {
    for (const name of readdirSync(migrations).filter(
      (name) => name.endsWith(".sql") && Number(name.split("_")[0]) <= upTo,
    ))
      cpSync(new URL(name, migrations), join(folder, name));
  };
  copy(37);
  applyMigrations(database, pathToFileURL(folder + sep));
  const request = (id: string, state: string, attempts: number) =>
    `INSERT INTO pantry_requests (id, user_id, generation, client_id, reference_kind, reference_id, product_id, stock_unit_id, quantity_per_serving, quantity, state, reason, attempt_count, created_at)
      VALUES ('${id}', 1, 1, '${id}', 'food', 1, 7, 2, 0.5, 1, '${state}', ${state === "rejected" ? "'unit_mismatch'" : "NULL"}, ${attempts}, '2026-01-01T00:00:00.000Z');`;
  const delivered = "00000000-0000-4000-8000-000000000001";
  const rejected = "00000000-0000-4000-8000-000000000002";
  database.exec(`INSERT INTO users (id, username, timezone, created_at) VALUES (1, 'example-person', 'UTC', '2026-01-01T00:00:00.000Z');
    ${request(delivered, "delivered", 1)}
    ${request(rejected, "rejected", 0)}
    INSERT INTO pantry_attempts VALUES ('${delivered}', 1, 'token', 'confirmed', NULL, NULL, '[]', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:01.000Z');`);
  copy(38);
  applyMigrations(database, pathToFileURL(folder + sep));
  assert.deepEqual(
    [
      database
        .prepare(
          "SELECT id, attempt_count, resolved_at FROM pantry_requests ORDER BY id",
        )
        .all(),
      database
        .prepare(
          "SELECT request_id, number, kind, finished_at FROM pantry_attempts ORDER BY request_id",
        )
        .all(),
    ],
    [
      [
        {
          id: delivered,
          attempt_count: 1,
          resolved_at: "2026-01-02T00:00:01.000Z",
        },
        { id: rejected, attempt_count: 1, resolved_at: null },
      ],
      [
        {
          request_id: delivered,
          number: 1,
          kind: "network",
          finished_at: "2026-01-02T00:00:01.000Z",
        },
        {
          request_id: rejected,
          number: 1,
          kind: "local_rejection",
          finished_at: null,
        },
      ],
    ],
  );
});

test("0058 keeps every stored set and allows a pin", (context) => {
  const database = new Database(":memory:");
  const folder = mkdtempSync(join(tmpdir(), "tare-pin-"));
  context.after(() => {
    database.close();
    rmSync(folder, { recursive: true, force: true });
  });
  cpSync(migrations, folder, { recursive: true });
  const migration = "0058_activity_set_pin.sql";
  rmSync(join(folder, migration));
  const before = pathToFileURL(folder + sep);
  database.pragma("foreign_keys = ON");
  applyMigrations(database, before);
  const instant = "2026-01-01T00:00:00.000Z";
  database.exec(`
    INSERT INTO users (id, username, timezone, created_at)
      VALUES (1, 'example-person', 'UTC', '${instant}');
    INSERT INTO activity_sessions (id, user_id, timing, day, kind, source, created_at)
      VALUES (1, 1, 'date_only', '2026-01-01', 'strength', 'manual', '${instant}');
    INSERT INTO activity_sets VALUES
      (1, 1, 1, 'Row', 'warmup', 10, 20, 'kg', NULL, NULL, NULL, NULL, 'first'),
      (1, 1, 2, 'Squat', 'working', 8, 22.68, 'lb', NULL, 3, 4, 'Slow', NULL),
      (1, 1, 3, 'Plank', 'working', NULL, NULL, NULL, 60, NULL, NULL, NULL, NULL);
  `);
  const sets = () => database.prepare("SELECT * FROM activity_sets").all();
  const stored = sets();
  cpSync(new URL(migration, migrations), join(folder, migration));
  applyMigrations(database, before);
  assert.deepEqual(sets(), stored);
  database.exec(
    "INSERT INTO activity_sets (user_id, session_id, set_index, exercise, load_kg, load_unit) VALUES (1, 1, 4, 'Pulldown', 10, 'pin')",
  );
  assert.equal(sets().length, 4);
});

test("0055 tags archived menu history and leaves sign-off and calories intact", (context) => {
  const database = new Database(":memory:");
  const folder = mkdtempSync(join(tmpdir(), "tare-eating-out-"));
  context.after(() => {
    database.close();
    rmSync(folder, { recursive: true, force: true });
  });
  cpSync(migrations, folder, { recursive: true });
  const migration = "0055_eating_out.sql";
  rmSync(join(folder, migration));
  const before = pathToFileURL(folder + sep);
  database.pragma("foreign_keys = ON");
  applyMigrations(database, before);

  const instant = "2026-01-01T00:00:00.000Z";
  database.exec(`
    INSERT INTO users (id, username, timezone, created_at)
      VALUES (1, 'example-person', 'UTC', '${instant}');
    INSERT INTO orders (id, user_id, service, delivery_date, status, created_at)
      VALUES (1, 1, 'Example delivery', '2026-01-01', 'processed', '${instant}');
    INSERT INTO order_meals (id, user_id, order_id, name, quantity, updated_at)
      VALUES (1, 1, 1, 'Example bowl', 1, '${instant}');
    INSERT INTO foods (id, user_id, name, kcal, provenance)
      VALUES (1, 1, 'Example menu', 500, 'label'), (2, 1, 'Example label', 500, 'label'),
        (3, 1, 'Example blank', 500, 'label'), (4, 1, 'Example estimate', 500, 'estimated'),
        (5, 1, 'Example linked', 500, 'label'), (6, 1, 'Example order food', 500, 'label');
    INSERT INTO source_foods (id, source, source_key, name, provenance, fetched_at)
      VALUES (1, 'usda', 'example', 'Example catalog food', 'verified', '${instant}');
    UPDATE foods SET source_food_id = 1 WHERE id = 5;
    UPDATE foods SET service = 'Example delivery', meal_name = 'Example meal' WHERE id = 6;
    INSERT INTO regular_meals (user_id, food_id, restaurant, baseline, archived_at, created_at)
      VALUES (1, 1, 'Example cafe', 'menu', '${instant}', '${instant}'),
        (1, 2, 'Example cafe', 'label', NULL, '${instant}'),
        (1, 3, char(9,32), 'menu', NULL, '${instant}'),
        (1, 4, 'Example cafe', 'estimate', NULL, '${instant}'),
        (1, 5, 'Example cafe', 'menu', NULL, '${instant}'),
        (1, 6, 'Example cafe', 'menu', NULL, '${instant}');
    WITH examples(id, client_id, food_id) AS (
      VALUES (1, 'archived', 1), (2, 'label', 2), (3, 'blank', 3), (4, 'order', 1), (5, 'reused', 1),
        (6, 'meal-part:legacy-log', 4), (7, 'catalog-copy', 5), (8, 'order-food', 6),
        (9, 'meal-part:00000000-0000-4000-8000-000000000001:1', 1)
    )
    INSERT INTO intake_entries (id, user_id, client_id, food_id, servings, eaten_at, day, kcal, provenance, created_at, updated_at)
      SELECT id, 1, client_id, food_id, 1, '${instant}', '2026-01-01', 500, 'label', '${instant}', '${instant}' FROM examples;
    INSERT INTO meal_actions (user_id, mutation_id, order_meal_id, action, intake_entry_id, result, created_at)
      VALUES (1, 'order', 1, 'ate', 4, '{}', '${instant}'),
        (1, 'reused', 1, 'ate', 5, '{}', '2025-12-31T00:00:00.000Z'),
        (1, 'stale-mutation', 1, 'ate', 6, '{}', '${instant}'),
        (1, 'meal-part:legacy-log', 1, 'ate', 7, '{}', '${instant}');
    INSERT INTO meal_receipts (user_id, client_id, part_key, request_hash, part_count, created_at)
      VALUES (1, 'example-parts', '00000000-0000-4000-8000-000000000001', printf('%064d', 0), 1, '${instant}');
    UPDATE days SET signed_off_at = '${instant}';
  `);
  cpSync(new URL(migration, migrations), join(folder, migration));
  applyMigrations(database, before);

  const snapshot = database
    .prepare(
      "SELECT eating_out, kcal_basis, kcal FROM intake_entries ORDER BY id",
    )
    .raw();
  assert.deepEqual(
    snapshot.all(),
    [1, 0, 0, 0, 1, 1, 0, 0, 0].map((tag) => [tag, "legacy", 500]),
  );
  assert.equal(
    database.prepare("SELECT signed_off_at FROM days").pluck().get(),
    instant,
  );
  const marker = database
    .prepare("SELECT eating_out_started_at FROM install")
    .pluck();
  const activation = String(marker.get());
  assert.equal(new Date(activation).toISOString(), activation);
});
