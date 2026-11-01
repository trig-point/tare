import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { type TestContext, test } from "node:test";
import { pathToFileURL } from "node:url";
import { applyMigrations, openDatabase } from "../src/db.ts";
import { type InsertDayParams, insertDay } from "../src/queries/insert-day.ts";
import {
  type InsertFoodParams,
  insertFood,
} from "../src/queries/insert-food.ts";
import {
  type InsertIntakeEntryParams,
  insertIntakeEntry,
} from "../src/queries/insert-intake-entry.ts";
import {
  type InsertSourceFoodParams,
  insertSourceFood,
} from "../src/queries/insert-source-food.ts";
import { insertUser } from "../src/queries/insert-user.ts";
import {
  type InsertWeightParams,
  insertWeight,
} from "../src/queries/insert-weight.ts";
import { selectDay } from "../src/queries/select-day.ts";
import { selectFood } from "../src/queries/select-food.ts";
import { selectIntakeEntry } from "../src/queries/select-intake-entry.ts";
import { selectSourceFood } from "../src/queries/select-source-food.ts";
import { selectUser } from "../src/queries/select-user.ts";
import { selectWeight } from "../src/queries/select-weight.ts";
import { updateFoodKcal } from "../src/queries/update-food-kcal.ts";
import { updateIntakeFood } from "../src/queries/update-intake-food.ts";
import { updateUserSettings } from "../src/queries/update-user-settings.ts";

const timestamp = "2024-02-29T12:34:56.789Z";
const editedAt = "2024-02-29T13:34:56.789Z";
const storedDay = "2024-02-29";
const unknownNutrients = {
  kcal: null,
  protein_g: null,
  carbs_g: null,
  fat_g: null,
  fiber_g: null,
};

function fixture(context: TestContext) {
  const connection = openDatabase(":memory:");
  context.after(connection.close);
  const database = connection.database;
  const users = ["sample-one", "sample-two"].map((username) => {
    const user = insertUser(database, {
      username,
      password_hash: "test-hash",
      timezone: "America/New_York",
      created_at: timestamp,
    });
    assert.ok(user);
    return user;
  });
  const first = users[0];
  const second = users[1];
  assert.ok(first && second);
  let sequence = 0;
  const food = (overrides: Partial<InsertFoodParams> = {}) =>
    insertFood(database, {
      user_id: first.id,
      name: "Sample meal",
      serving_size: null,
      serving_unit: null,
      ...unknownNutrients,
      kcal_low: null,
      kcal_high: null,
      provenance: "estimated",
      source: null,
      source_food_id: null,
      ...overrides,
    });
  const entry = (overrides: Partial<InsertIntakeEntryParams> = {}) =>
    insertIntakeEntry(database, {
      user_id: first.id,
      client_id: `intake-${++sequence}`,
      food_id: null,
      source_food_id: null,
      servings: null,
      eaten_at: timestamp,
      day: storedDay,
      ...unknownNutrients,
      kcal_low: null,
      kcal_high: null,
      provenance: "estimated",
      source: null,
      portion_note: null,
      created_at: timestamp,
      updated_at: timestamp,
      ...overrides,
    });
  const weight = (overrides: Partial<InsertWeightParams> = {}) =>
    insertWeight(database, {
      user_id: first.id,
      client_id: `weight-${++sequence}`,
      measured_at: timestamp,
      day: storedDay,
      weight_kg: 70,
      body_fat_pct: null,
      source: null,
      created_at: timestamp,
      ...overrides,
    });
  const day = (
    overrides: Partial<
      Omit<InsertDayParams, "user_id"> & { user_id: number }
    > = {},
  ) =>
    insertDay(database, {
      user_id: first.id,
      day: storedDay,
      signed_off_at: null,
      hunger: null,
      fullness: null,
      notes: null,
      ...overrides,
    });
  const cache = (overrides: Partial<InsertSourceFoodParams> = {}) =>
    insertSourceFood(database, {
      source: "usda",
      source_key: `sample-${++sequence}`,
      name: "Sample product",
      brand: null,
      serving_size: null,
      serving_unit: null,
      ...unknownNutrients,
      provenance: "verified",
      fetched_at: timestamp,
      ...overrides,
    });
  return { database, first, second, food, entry, weight, day, cache };
}

test("upgrade from populated 0001 drops the placeholder and preserves its checksum", (context) => {
  const connection = openDatabase(":memory:");
  context.after(connection.close);
  const database = connection.database;
  const directory = mkdtempSync(join(tmpdir(), "tare-core-upgrade-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const migrations = new URL("../migrations/", import.meta.url);
  cpSync(migrations, directory, { recursive: true });
  for (const name of readdirSync(directory)) {
    if (name !== "0001_foundation.sql") rmSync(join(directory, name));
  }
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
  database.prepare("INSERT INTO foundation (id) VALUES (?)").run(17);
  assert.deepEqual(database.prepare("SELECT id FROM foundation").all(), [
    { id: 17 },
  ]);
  assert.deepEqual(
    database.prepare("SELECT name FROM schema_migrations").all(),
    [{ name: "0001_foundation.sql" }],
  );
  const checksum = database
    .prepare("SELECT content_hash FROM schema_migrations WHERE name = ?")
    .get("0001_foundation.sql");
  assert.deepEqual(checksum, {
    content_hash: createHash("sha256")
      .update(readFileSync(new URL("0001_foundation.sql", migrations)))
      .digest("hex"),
  });
  cpSync(migrations, directory, { recursive: true });
  applyMigrations(database, folder);
  assert.equal(
    database
      .prepare("SELECT name FROM sqlite_schema WHERE name = ?")
      .get("foundation"),
    undefined,
  );
  assert.deepEqual(
    database
      .prepare("SELECT content_hash FROM schema_migrations WHERE name = ?")
      .get("0001_foundation.sql"),
    checksum,
  );
  const before = database.prepare("SELECT total_changes() AS count").get();
  applyMigrations(database, folder);
  assert.deepEqual(
    database.prepare("SELECT total_changes() AS count").get(),
    before,
  );
  assert.deepEqual(database.pragma("foreign_key_check"), []);
});

test("fresh replay creates strict tables, defaults, typed reads and missing-row results", (context) => {
  const { database, first, second, food, entry, weight, day, cache } =
    fixture(context);
  assert.equal(first.day_start_hour, 4);
  assert.equal(first.is_admin, 0);
  assert.deepEqual(selectUser(database, { id: first.id }), first);
  const sourceFood = cache();
  const ownedFood = food();
  const intake = entry();
  const measurement = weight();
  const summary = day();
  assert.ok(sourceFood && ownedFood && intake && measurement && summary);
  assert.deepEqual(
    selectSourceFood(database, { id: sourceFood.id }),
    sourceFood,
  );
  assert.deepEqual(
    selectFood(database, { user_id: first.id, id: ownedFood.id }),
    ownedFood,
  );
  assert.deepEqual(
    selectIntakeEntry(database, { user_id: first.id, id: intake.id }),
    intake,
  );
  assert.deepEqual(
    selectWeight(database, { user_id: first.id, id: measurement.id }),
    measurement,
  );
  assert.deepEqual(
    selectDay(database, { user_id: first.id, day: storedDay }),
    summary,
  );
  assert.equal(selectUser(database, { id: 999 }), null);
  assert.equal(selectSourceFood(database, { id: 999 }), null);
  assert.equal(
    selectFood(database, { user_id: second.id, id: ownedFood.id }),
    null,
  );
  assert.equal(
    selectIntakeEntry(database, { user_id: second.id, id: intake.id }),
    null,
  );
  assert.equal(
    selectWeight(database, { user_id: second.id, id: measurement.id }),
    null,
  );
  assert.equal(
    selectDay(database, { user_id: second.id, day: storedDay }),
    null,
  );
  const tables = database.pragma("table_list") as {
    name: string;
    strict: number;
  }[];
  for (const name of [
    "users",
    "source_foods",
    "foods",
    "intake_entries",
    "weights",
    "days",
  ])
    assert.equal(tables.find((table) => table.name === name)?.strict, 1);
  for (const row of [sourceFood, ownedFood, intake]) {
    for (const column of Object.keys(
      unknownNutrients,
    ) as (keyof typeof unknownNutrients)[])
      assert.equal(row[column], null);
  }
  assert.equal(summary.hunger, null);
  assert.equal(summary.fullness, null);
});

test("owner keys reject cross-owner inserts and updates while same-owner and NULL references pass", (context) => {
  const { database, first, second, food, entry, weight, day, cache } =
    fixture(context);
  const firstFood = food();
  const secondFood = food({ user_id: second.id });
  const shared = cache();
  assert.ok(firstFood && secondFood && shared);
  assert.throws(
    () => entry({ food_id: secondFood.id }),
    /FOREIGN KEY constraint failed/,
  );
  const intake = entry({ food_id: firstFood.id });
  assert.ok(intake);
  assert.throws(
    () =>
      updateIntakeFood(
        database,
        { food_id: secondFood.id, updated_at: editedAt },
        { user_id: first.id, id: intake.id },
      ),
    /FOREIGN KEY constraint failed/,
  );
  assert.deepEqual(
    updateIntakeFood(
      database,
      { food_id: null, updated_at: editedAt },
      { user_id: first.id, id: intake.id },
    ).map((row) => row.food_id),
    [null],
  );
  assert.deepEqual(
    updateIntakeFood(
      database,
      { food_id: firstFood.id, updated_at: editedAt },
      { user_id: first.id, id: intake.id },
    ).map((row) => row.food_id),
    [firstFood.id],
  );
  assert.throws(
    () =>
      database
        .prepare("UPDATE foods SET user_id = ? WHERE user_id = ? AND id = ?")
        .run(second.id, first.id, firstFood.id),
    /FOREIGN KEY constraint failed/,
  );
  assert.throws(
    () =>
      database
        .prepare(
          "UPDATE intake_entries SET user_id = ? WHERE user_id = ? AND id = ?",
        )
        .run(second.id, first.id, intake.id),
    /FOREIGN KEY constraint failed/,
  );
  assert.throws(
    () =>
      database
        .prepare(
          "UPDATE intake_entries SET source_food_id = ? WHERE user_id = ? AND id = ?",
        )
        .run(shared.id, first.id, intake.id),
    /CHECK constraint failed/,
  );
  assert.equal(
    selectIntakeEntry(database, { user_id: first.id, id: intake.id })
      ?.updated_at,
    editedAt,
  );
  assert.ok(entry({ user_id: second.id, food_id: secondFood.id }));
  for (const user_id of [first.id, second.id]) {
    assert.ok(food({ user_id, source_food_id: shared.id }));
    assert.ok(entry({ user_id, source_food_id: shared.id }));
  }
  for (const create of [food, entry, weight, day])
    assert.throws(
      () => create({ user_id: 999 }),
      /FOREIGN KEY constraint failed/,
    );
  assert.throws(
    () => food({ source_food_id: 999 }),
    /FOREIGN KEY constraint failed/,
  );
  assert.throws(
    () => entry({ source_food_id: 999 }),
    /FOREIGN KEY constraint failed/,
  );
  assert.throws(
    () => entry({ food_id: firstFood.id, source_food_id: shared.id }),
    /CHECK constraint failed/,
  );
  assert.equal(
    selectIntakeEntry(database, { user_id: first.id, id: intake.id })?.food_id,
    firstFood.id,
  );
});

test("every personal table refuses a NULL owner", (context) => {
  const { food, entry, weight, day } = fixture(context);
  for (const create of [food, entry, weight, day])
    assert.throws(
      () => Reflect.apply(create, undefined, [{ user_id: null }]),
      /NOT NULL constraint failed/,
    );
});

test("usernames and day keys reject duplicates while two people can store the same day", (context) => {
  const { database, first, second, day } = fixture(context);
  assert.throws(
    () =>
      insertUser(database, {
        username: first.username,
        password_hash: "test-hash",
        timezone: "UTC",
        created_at: timestamp,
      }),
    /UNIQUE constraint failed/,
  );
  assert.ok(day());
  assert.ok(day({ user_id: second.id }));
  assert.throws(() => day(), /UNIQUE constraint failed/);
  assert.throws(() => day({ user_id: second.id }), /UNIQUE constraint failed/);
  assert.equal(
    selectDay(database, { user_id: first.id, day: storedDay })?.user_id,
    first.id,
  );
  assert.equal(
    selectDay(database, { user_id: second.id, day: storedDay })?.user_id,
    second.id,
  );
});

test("client ids are unique per person for both intake and weights", (context) => {
  const { first, second, entry, weight } = fixture(context);
  for (const create of [entry, weight]) {
    const initial = create({ user_id: first.id, client_id: "same-request" });
    const other = create({ user_id: second.id, client_id: "same-request" });
    assert.ok(initial && other);
    assert.notEqual(initial.id, other.id);
    assert.throws(
      () => create({ user_id: first.id, client_id: "same-request" }),
      /UNIQUE constraint failed/,
    );
  }
});

test("intake keeps its stored nutrition after catalog edits", (context) => {
  const { database, first, food, entry } = fixture(context);
  const owned = food({ kcal: 100 });
  assert.ok(owned);
  const intake = entry({
    food_id: owned.id,
    kcal: 100,
    protein_g: 4,
    kcal_low: 90,
    kcal_high: 110,
    provenance: "label",
    source: "Sample label",
  });
  assert.ok(intake);
  assert.equal(
    updateFoodKcal(database, { kcal: 200 }, { user_id: first.id, id: owned.id })
      ?.kcal,
    200,
  );
  assert.deepEqual(
    selectIntakeEntry(database, { user_id: first.id, id: intake.id }),
    intake,
  );
});

test("dates require real calendar days and canonical UTC timestamps", (context) => {
  const { database, entry, weight, day, cache } = fixture(context);
  assert.ok(day({ signed_off_at: timestamp, hunger: -10, fullness: 100 }));
  const invalidDays = ["2026-02-30", "202X-02-20", "", "2026-2-02"];
  for (const invalid of invalidDays) {
    assert.throws(() => entry({ day: invalid }), /CHECK constraint failed/);
    assert.throws(() => weight({ day: invalid }), /CHECK constraint failed/);
    assert.throws(() => day({ day: invalid }), /CHECK constraint failed/);
  }
  const invalidTimes = [
    "2026-02-30T12:34:56.789Z",
    "202X-02-20T12:34:56.789Z",
    "2026-02-20T99:34:56.789Z",
    "2026-02-20T12:34:56.789+00:00",
    "2026-02-20T12:34:56Z",
    "",
  ];
  for (const invalid of invalidTimes) {
    assert.throws(
      () =>
        insertUser(database, {
          username: "invalid-time",
          password_hash: "test-hash",
          timezone: "UTC",
          created_at: invalid,
        }),
      /CHECK constraint failed/,
    );
    assert.throws(
      () => cache({ fetched_at: invalid }),
      /CHECK constraint failed/,
    );
    for (const column of ["eaten_at", "created_at", "updated_at"])
      assert.throws(
        () => entry({ [column]: invalid }),
        /CHECK constraint failed/,
      );
    for (const column of ["measured_at", "created_at"])
      assert.throws(
        () => weight({ [column]: invalid }),
        /CHECK constraint failed/,
      );
    assert.throws(
      () => day({ day: "2024-03-01", signed_off_at: invalid }),
      /CHECK constraint failed/,
    );
  }
});

test("kcal ranges require paired ordered bounds that contain known kcal", (context) => {
  const { food, entry } = fixture(context);
  for (const create of [food, entry]) {
    for (const invalid of [
      { kcal_low: 10 },
      { kcal_high: 20 },
      { kcal_low: 20, kcal_high: 10 },
      { kcal: 30, kcal_low: 10, kcal_high: 20 },
      { kcal: 5, kcal_low: 10, kcal_high: 20 },
    ])
      assert.throws(() => create(invalid), /CHECK constraint failed/);
    assert.ok(create());
    assert.ok(create({ kcal_low: 0, kcal_high: 20 }));
    assert.ok(create({ kcal: 10, kcal_low: 10, kcal_high: 10 }));
  }
});

test("nutrients are non-negative and known serving amounts are positive", (context) => {
  const { food, entry, cache, weight } = fixture(context);
  for (const create of [food, entry, cache]) {
    for (const column of Object.keys(unknownNutrients))
      assert.throws(() => create({ [column]: -1 }), /CHECK constraint failed/);
    assert.ok(
      create({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 }),
    );
  }
  for (const create of [food, entry]) {
    for (const invalid of [
      { kcal_low: -1, kcal_high: 10 },
      { kcal_low: -2, kcal_high: -1 },
    ])
      assert.throws(() => create(invalid), /CHECK constraint failed/);
  }
  for (const invalid of [0, -1]) {
    for (const create of [food, cache])
      assert.throws(
        () => create({ serving_size: invalid }),
        /CHECK constraint failed/,
      );
    assert.throws(
      () => entry({ servings: invalid }),
      /CHECK constraint failed/,
    );
    assert.throws(
      () => weight({ weight_kg: invalid }),
      /CHECK constraint failed/,
    );
  }
  assert.ok(food({ serving_size: 0.5 }));
  assert.ok(cache({ serving_size: 0.5 }));
  assert.ok(entry({ servings: 0.5 }));
});

test("provenance, cache keys, user settings and body fat enforce their contracts", (context) => {
  const { database, first, food, entry, cache, weight } = fixture(context);
  for (const create of [food, entry, cache])
    assert.throws(
      () => create({ provenance: "unknown" }),
      /CHECK constraint failed/,
    );
  assert.throws(
    () => cache({ provenance: "estimated" }),
    /CHECK constraint failed/,
  );
  assert.throws(() => cache({ source: "other" }), /CHECK constraint failed/);
  assert.ok(cache({ source_key: "shared-key" }));
  assert.throws(
    () => cache({ source_key: "shared-key" }),
    /UNIQUE constraint failed/,
  );
  assert.ok(
    cache({ source: "off", source_key: "shared-key", provenance: "label" }),
  );
  for (const invalid of [-1, 24])
    assert.throws(
      () =>
        updateUserSettings(
          database,
          { day_start_hour: invalid },
          { id: first.id },
        ),
      /CHECK constraint failed/,
    );
  assert.throws(
    () =>
      database
        .prepare("UPDATE users SET is_admin = ? WHERE id = ?")
        .run(2, first.id),
    /CHECK constraint failed/,
  );
  database
    .prepare("UPDATE users SET is_admin = ? WHERE id = ?")
    .run(1, first.id);
  for (const valid of [0, 23])
    assert.equal(
      updateUserSettings(
        database,
        { day_start_hour: valid },
        { id: first.id },
      )[0]?.day_start_hour,
      valid,
    );
  assert.equal(selectUser(database, { id: first.id })?.is_admin, 1);
  for (const invalid of [-1, 101])
    assert.throws(
      () => weight({ body_fat_pct: invalid }),
      /CHECK constraint failed/,
    );
  assert.ok(weight({ body_fat_pct: 0 }));
  assert.ok(weight({ body_fat_pct: 100 }));
  assert.ok(food({ provenance: "verified" }));
  assert.ok(entry({ provenance: "label" }));
});
