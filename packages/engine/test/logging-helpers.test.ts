import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  applyMigrations,
  openDatabase,
  type WriteScope,
  writeTransaction,
} from "../src/db.ts";
import { canonicalInstant, localDay } from "../src/logging/day.ts";
import { insertIntake } from "../src/logging/intake.ts";
import { resolveProvenance } from "../src/logging/provenance.ts";
import { numbersFrom } from "../src/logging/schemas.ts";
import { fixture } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";

test("local days follow literal DST and half-hour cases; timestamps reject rollovers", () => {
  for (const [instant, zone, expected] of [
    ["2026-03-08T06:59:59Z", "America/New_York", "2026-03-07"],
    ["2026-03-08T07:00Z", "America/New_York", "2026-03-07"],
    ["2026-03-08T07:59:59Z", "America/New_York", "2026-03-07"],
    ["2026-03-08T08:00Z", "America/New_York", "2026-03-08"],
    ["2026-11-01T05:30Z", "America/New_York", "2026-10-31"],
    ["2026-11-01T06:30Z", "America/New_York", "2026-10-31"],
    ["2026-11-01T08:59Z", "America/New_York", "2026-10-31"],
    ["2026-11-01T09:00Z", "America/New_York", "2026-11-01"],
    ["2026-03-07T18:30Z", "Asia/Kolkata", "2026-03-07"],
    ["2026-03-07T22:29Z", "Asia/Kolkata", "2026-03-07"],
    ["2026-03-07T22:30Z", "Asia/Kolkata", "2026-03-08"],
    ["2026-01-01T00:00Z", "UTC", "2025-12-31"],
    ["2026-01-01T04:00Z", "UTC", "2026-01-01"],
  ] as const)
    assert.equal(localDay(instant, zone, 4), expected);
  assert.equal(localDay("2026-01-01T00:00Z", "UTC", 0), "2026-01-01");
  assert.equal(
    canonicalInstant("2026-01-01T05:30:00+05:30"),
    "2026-01-01T00:00:00.000Z",
  );
  for (const value of [
    "",
    "bad",
    "2026-01-01",
    "2026-02-30T00:00:00Z",
    "2026-01-01T24:00:00Z",
  ])
    assert.throws(() => canonicalInstant(value), /invalid_time/);
  for (const [claim, food, result] of [
    [{}, null, "estimated"],
    [{ provenance: "estimated" }, null, "estimated"],
    [{ provenance: "label", source: "Box" }, null, "label"],
    [{ provenance: "verified" }, null, "verified_not_allowed"],
    [{ provenance: "label" }, null, "label_source_required"],
    [
      { provenance: "estimated" },
      { provenance: "verified" },
      "provenance_mismatch",
    ],
    [{ provenance: "verified" }, { provenance: "verified" }, "verified"],
  ] as const) {
    if (result.includes("_"))
      assert.throws(() => resolveProvenance(claim, food), new RegExp(result));
    else assert.equal(resolveProvenance(claim, food), result);
  }
});

test("write scopes admit one immediate batch and reject nesting, expiry and forgery", (context) => {
  const person = fixture(context).admin;
  const traces: string[] = [];
  const database = new Database(":memory:", {
    verbose: (statement) => traces.push(String(statement)),
  });
  context.after(() => database.close());
  applyMigrations(database);
  database
    .prepare(
      "INSERT INTO users (id, username, timezone, is_admin, created_at) VALUES (?, 'Example', 'UTC', 1, ?)",
    )
    .run(person.id, "2026-01-01T00:00:00.000Z");
  const input = {
    client_id: "one",
    name: "Example snack",
    numbers: numbersFrom({ kcal: 100 }),
    claim: {},
  };
  const clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };
  traces.length = 0;
  const expired = writeTransaction(database, (scope) => {
    insertIntake(scope, person, input, clock);
    insertIntake(scope, person, { ...input, client_id: "two" }, clock);
    return scope;
  });
  assert.equal(
    traces.filter((statement) => statement === "BEGIN IMMEDIATE").length,
    1,
  );
  assert.equal(
    database
      .prepare("SELECT count(*) AS count FROM intake_entries")
      .pluck()
      .get(),
    2,
  );
  assert.throws(() => insertIntake(expired, person, input, clock), /Inactive/);
  const forged = { database };
  // @ts-expect-error A database alone cannot grant a write scope.
  assert.throws(() => insertIntake(forged, person, input, clock), /Inactive/);
  let ran = false;
  database.transaction(() =>
    assert.throws(
      () =>
        writeTransaction(database, () => {
          ran = true;
        }),
      /cannot nest/,
    ),
  )();
  assert.equal(ran, false);
  let failedScope: WriteScope | undefined;
  assert.throws(
    () =>
      writeTransaction(database, (scope) => {
        failedScope = scope;
        throw new Error("rollback");
      }),
    /rollback/,
  );
  assert.ok(failedScope);
  const invalidated = failedScope;
  assert.throws(
    () => insertIntake(invalidated, person, input, clock),
    /Inactive/,
  );
});

test("WAL permits committed reads; BEGIN IMMEDIATE takes the write lock at begin", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "tare-logging-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = openDatabase(join(directory, "test.sqlite"));
  const second = openDatabase(join(directory, "test.sqlite"));
  context.after(() => {
    second.close();
    first.close();
  });
  assert.equal(first.database.pragma("journal_mode", { simple: true }), "wal");
  assert.equal(first.database.pragma("busy_timeout", { simple: true }), 5000);
  second.database.pragma("busy_timeout = 0");
  writeTransaction(first.database, () => {
    first.database
      .prepare(
        "INSERT INTO users (username, timezone, created_at) VALUES ('Example', 'UTC', '2026-01-01T00:00:00.000Z')",
      )
      .run();
    assert.equal(
      second.database.prepare("SELECT count(*) FROM users").pluck().get(),
      0,
    );
    assert.throws(() => writeTransaction(second.database, () => {}), {
      code: "SQLITE_BUSY",
    });
  });
  assert.equal(
    second.database.prepare("SELECT count(*) FROM users").pluck().get(),
    1,
  );
});
