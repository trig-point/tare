import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { type TestContext, test } from "node:test";
import { openDatabase } from "../src/db.ts";
import { cte } from "../src/queries/compat/cte.ts";
import { type InListParams, inList } from "../src/queries/compat/in-list.ts";
import { returning } from "../src/queries/compat/returning.ts";
import { upsert } from "../src/queries/compat/upsert.ts";
import { window } from "../src/queries/compat/window.ts";
import { json } from "./compat/json.mts";
import { leftJoin } from "./compat/left-join.mts";

type Equal<Actual, Expected> = (<Value>() => Value extends Actual
  ? 1
  : 2) extends <Value>() => Value extends Expected ? 1 : 2
  ? true
  : false;
const typeChecks: [
  Equal<Parameters<typeof returning>[1], { label: string }>,
  Equal<Parameters<typeof returning>[2], { minimum: number }>,
  Equal<ReturnType<typeof returning>, { id: number; label: string }[]>,
  Equal<Parameters<typeof upsert>[1], { id: number | null; label: string }>,
  Equal<ReturnType<typeof upsert>, { id: number; label: string } | null>,
  Equal<Parameters<typeof cte>[1], { minimum: number }>,
  Equal<ReturnType<typeof cte>, { id: number; label: string }[]>,
  Equal<Parameters<typeof window>, [db: Parameters<typeof cte>[0]]>,
  Equal<ReturnType<typeof window>, { id: number; position: number }[]>,
  Equal<InListParams, { ids: number[] }>,
  Equal<ReturnType<typeof inList>, { id: number; label: string }[]>,
  Equal<ReturnType<typeof leftJoin>[number]["name"], string | null>,
  Equal<ReturnType<typeof json>["name"], unknown>,
  Equal<Equal<ReturnType<typeof JSON.parse>, unknown>, false>,
] = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];
assert.ok(typeChecks.every(Boolean));

function setup(context: TestContext) {
  const connection = openDatabase(":memory:");
  context.after(() => connection.close());
  const database = connection.database;
  database.exec(
    readFileSync(
      new URL("./fixtures/typesql-compat.sql", import.meta.url),
      "utf8",
    ),
  );
  database
    .prepare("INSERT INTO compat_groups (id, name) VALUES (?, ?)")
    .run(1, "Example group");
  const insert = database.prepare(
    "INSERT INTO compat_items (id, label, group_id) VALUES (?, ?, ?)",
  );
  insert.run(1, "first", 1);
  insert.run(2, "second", null);
  return database;
}

for (const [minimum, expected] of [
  [3, []],
  [2, [{ id: 2, label: "updated" }]],
  [
    1,
    [
      { id: 1, label: "updated" },
      { id: 2, label: "updated" },
    ],
  ],
] as const) {
  test(`RETURNING returns ${expected.length} rows`, (context) => {
    const database = setup(context);
    assert.deepEqual(
      returning(database, { label: "updated" }, { minimum }).sort(
        (first, second) => first.id - second.id,
      ),
      expected,
    );
    assert.deepEqual(cte(database, { minimum: 1 }), [
      { id: 1, label: minimum <= 1 ? "updated" : "first" },
      { id: 2, label: minimum <= 2 ? "updated" : "second" },
    ]);
  });
}

test("upsert inserts and updates the conflicting row", (context) => {
  const database = setup(context);
  assert.deepEqual(upsert(database, { id: 3, label: "third" }), {
    id: 3,
    label: "third",
  });
  assert.deepEqual(upsert(database, { id: 3, label: "changed" }), {
    id: 3,
    label: "changed",
  });
  assert.deepEqual(inList(database, { ids: [3] }), [
    { id: 3, label: "changed" },
  ]);
});

test("LEFT JOIN preserves unmatched rows as null", (context) => {
  assert.deepEqual(leftJoin(setup(context)), [
    { id: 1, name: "Example group" },
    { id: 2, name: null },
  ]);
});

test("CTE filters rows and handles no matches", (context) => {
  const database = setup(context);
  assert.deepEqual(cte(database, { minimum: 2 }), [{ id: 2, label: "second" }]);
  assert.deepEqual(cte(database, { minimum: 3 }), []);
});

test("window function numbers ordered rows", (context) => {
  const database = setup(context);
  database.prepare("UPDATE compat_items SET id = ? WHERE id = ?").run(7, 2);
  assert.deepEqual(window(database), [
    { id: 1, position: 1 },
    { id: 7, position: 2 },
  ]);
  database.prepare("DELETE FROM compat_items").run();
  assert.deepEqual(window(database), []);
});

test("JSON extracts values, returns null for missing input, and rejects malformed input", (context) => {
  const database = setup(context);
  assert.deepEqual(json(database, '{"name":"Example"}'), { name: "Example" });
  assert.deepEqual(json(database, "{}"), { name: null });
  assert.deepEqual(json(database, null), { name: null });
  assert.throws(() => json(database, "{"), /malformed JSON/);
});

for (const ids of [[1], [1, 2], []]) {
  test(`IN list accepts ${ids.length} items`, (context) => {
    const database = setup(context);
    assert.deepEqual(
      inList(database, { ids }),
      ids.map((id) => ({ id, label: id === 1 ? "first" : "second" })),
    );
  });
}
