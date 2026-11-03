import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.ts";
import { type ImportKind, importFiles } from "../src/import/files.ts";
import { selectDay } from "../src/queries/select-day.ts";
import { selectIntakeByClient } from "../src/queries/select-intake-by-client.ts";
import { selectWeightByClient } from "../src/queries/select-weight-by-client.ts";
import { test } from "./support/hang-ceiling.ts";

const clock = { now: () => new Date("2026-01-01T00:00:00Z") };
const intake = {
  client_id: "example-soup",
  name: "Example soup",
  kcal: 240,
  provenance: "estimated",
  eaten_at: "2025-06-01T23:00:00Z",
};
const weight = {
  client_id: "example-scale",
  measured_at: "2025-06-03T12:00:00Z",
  weight_kg: 75,
  source: "Example scale",
};
const days = { day: "2025-06-04", hunger: 3, notes: "Example note" };

function setup(context: Parameters<Parameters<typeof test>[1]>[0]) {
  const directory = mkdtempSync(join(tmpdir(), "tare-import-"));
  const path = join(directory, "import.sqlite");
  const connection = openDatabase(path);
  context.after(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const database = connection.database;
  for (const username of ["example", "other"])
    database
      .prepare(
        "INSERT INTO users (username, timezone, created_at) VALUES (?, 'Asia/Kolkata', '2025-01-01T00:00:00.000Z')",
      )
      .run(username);
  database
    .prepare(
      "INSERT INTO days (user_id, day, signed_off_at) VALUES (?, ?, '2026-01-01T00:00:00.000Z')",
    )
    .run(2, days.day);
  const snapshot = (owner = 1) =>
    ["intake_entries", "weights", "days"].map((table) =>
      database
        .prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY rowid`)
        .all(owner),
    );
  const run = async (
    kind: ImportKind,
    rows: unknown[],
    username = "example",
  ) => {
    const file = join(directory, `${kind}.jsonl`);
    writeFileSync(
      file,
      rows
        .map((row) => (typeof row === "string" ? row : JSON.stringify(row)))
        .join("\n") + (rows.length ? "\n" : ""),
    );
    return (await importFiles(database, username, { [kind]: file }, clock))[0];
  };
  const sign = (day: string) =>
    database
      .prepare(
        "INSERT INTO days (user_id, day, signed_off_at) VALUES (1, ?, '2026-01-01T00:00:00.000Z') ON CONFLICT (user_id, day) DO UPDATE SET signed_off_at = '2026-01-01T00:00:00.000Z'",
      )
      .run(day);
  return { database, path, directory, snapshot, run, sign };
}

for (const kind of ["intake", "weight", "days"] as const)
  test(`${kind}: rows validate, replay and preserve the other person`, async (context) => {
    const { database, run, snapshot, sign } = setup(context);
    const row = { intake, weight, days }[kind];
    await run(kind, [row], "other");
    const otherBefore = snapshot(2);
    const day = kind === "intake" ? "2025-06-02" : days.day;
    if (kind !== "weight") sign(day);
    const rows = [
      row,
      "{broken",
      { ...row, unexpected: "private value" },
      ...(kind === "days"
        ? [{ ...row, notes: " " }]
        : [
            {
              ...row,
              [kind === "intake" ? "eaten_at" : "measured_at"]:
                "0026-01-01T00:00:00Z",
            },
          ]),
    ];
    const result = await run(kind, rows);
    assert.deepEqual(result, {
      kind,
      applied: 1,
      replayed: 0,
      skipped: rows.length - 1,
      errors: [
        { line: 2, code: "invalid_row" },
        { line: 3, code: "invalid_row" },
        { line: 4, code: kind === "days" ? "invalid_row" : "invalid_time" },
      ],
    });
    if (kind === "intake") {
      const stored = selectIntakeByClient(database, {
        user_id: 1,
        client_id: intake.client_id,
      });
      assert.equal(stored?.protein_g, null);
      assert.equal(stored?.provenance, "estimated");
      assert.equal(stored?.day, day);
    }
    if (kind === "weight") {
      const stored = selectWeightByClient(database, {
        user_id: 1,
        client_id: weight.client_id,
      });
      assert.equal(stored?.source, weight.source);
      assert.equal(stored?.weight_kg, weight.weight_kg);
      assert.deepEqual(snapshot()[2], []);
    } else {
      assert.equal(
        selectDay(database, { user_id: 1, day })?.signed_off_at,
        null,
      );
      sign(day);
    }
    const beforeReplay = snapshot();
    assert.deepEqual(await run(kind, rows), {
      ...result,
      applied: 0,
      replayed: 1,
    });
    assert.deepEqual(snapshot(), beforeReplay);
    assert.deepEqual(snapshot(2), otherBefore);
    assert.deepEqual(await run(kind, []), {
      kind,
      applied: 0,
      replayed: 0,
      skipped: 0,
      errors: [],
    });
  });

test("days conflicts are atomic and preserve sign-off; writer failures skip only their line", async (context) => {
  const { database, run, snapshot, sign } = setup(context);
  await run("days", [days]);
  sign(days.day);
  const before = snapshot();
  assert.deepEqual(
    (await run("days", [{ ...days, hunger: 4, fullness: 5 }]))?.errors,
    [{ line: 1, code: "conflict" }],
  );
  assert.deepEqual(snapshot(), before);
  assert.equal(
    (await run("days", [{ day: days.day, fullness: 4 }]))?.applied,
    1,
  );
  assert.equal(
    selectDay(database, { user_id: 1, day: days.day })?.signed_off_at,
    null,
  );
  const result = await run("intake", [
    { ...intake, provenance: "label" },
    intake,
  ]);
  assert.deepEqual(result?.errors, [
    { line: 1, code: "label_source_required" },
  ]);
  assert.equal(result?.applied, 1);
});

test("command rejects unknown people and usage without writes; skipped lines exit 1", (context) => {
  const { database, path, directory, snapshot } = setup(context);
  const file = join(directory, "input.jsonl");
  writeFileSync(file, `${JSON.stringify(intake)}\n{broken\n`);
  const before = snapshot();
  const command = (args: string[]) =>
    spawnSync(
      process.execPath,
      [new URL("../scripts/import.mts", import.meta.url).pathname, ...args],
      { encoding: "utf8", env: { ...process.env, DATABASE_URL: path } },
    );
  const unknown = command(["--user", "missing", "--intake", file]);
  assert.equal(unknown.status, 2);
  assert.deepEqual(JSON.parse(unknown.stderr), { code: "unknown_person" });
  assert.deepEqual(snapshot(), before);
  assert.equal(
    database
      .prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM users")
      .get()?.count,
    2,
  );
  assert.equal(command(["--user", "example"]).status, 2);
  assert.equal(
    command(["--user", "example", "--days", join(directory, "missing")]).status,
    2,
  );
  const imported = command(["--user", "example", "--intake", file]);
  assert.equal(imported.status, 1);
  assert.deepEqual(JSON.parse(imported.stdout).errors, [
    { line: 2, code: "invalid_row" },
  ]);
  writeFileSync(file, `${JSON.stringify(intake)}\n`);
  assert.equal(command(["--user", "example", "--intake", file]).status, 0);
});

test("import waits for a different process to release its write lock", async (context) => {
  const { database, path, directory } = setup(context);
  const file = join(directory, "weight.jsonl");
  writeFileSync(file, JSON.stringify(weight));
  const start = () =>
    fork(new URL("./support/import-lock.mts", import.meta.url), [path], {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
  const writer = start();
  const reader = start();
  context.after(() => {
    for (const child of [writer, reader])
      if (child.exitCode === null) child.kill();
  });
  const exited = Promise.all([once(writer, "exit"), once(reader, "exit")]);
  await Promise.all([once(writer, "message"), once(reader, "message")]);
  database.exec("BEGIN IMMEDIATE");
  try {
    const attempting = once(writer, "message");
    writer.send(file);
    assert.equal((await attempting)[0], "attempting");
    let committed = false;
    const result = once(writer, "message").then(([summary]) => {
      committed = true;
      return summary;
    });
    const read = once(reader, "message");
    reader.send({ read: true });
    assert.deepEqual((await read)[0], { count: 0 });
    assert.equal(committed, false);
    database.exec("COMMIT");
    assert.equal((await result)[0].applied, 1);
    assert.deepEqual(await exited, [
      [0, null],
      [0, null],
    ]);
  } finally {
    if (database.inTransaction) database.exec("ROLLBACK");
  }
});
