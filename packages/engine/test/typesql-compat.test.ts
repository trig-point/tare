import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { type TestContext, test } from "node:test";
import { openDatabase } from "../src/db.ts";
import { cte } from "../src/queries/compat/cte.ts";
import { type InListParams, inList } from "../src/queries/compat/in-list.ts";
import { json } from "../src/queries/compat/json.mts";
import { leftJoin } from "../src/queries/compat/left-join.mts";
import { returning } from "../src/queries/compat/returning.ts";
import { upsert } from "../src/queries/compat/upsert.ts";
import { window } from "../src/queries/compat/window.ts";

type Equal<Actual, Expected> = (<Value>() => Value extends Actual
  ? 1
  : 2) extends <Value>() => Value extends Expected ? 1 : 2
  ? true
  : false;
const returningArray: Equal<
  ReturnType<typeof returning>,
  { id: number; label: string }[]
> = true;
const nullableJoin: Equal<
  ReturnType<typeof leftJoin>[number]["name"],
  string | null
> = true;
const listParameter: Equal<InListParams["ids"], number[]> = true;
assert.ok(returningArray && nullableJoin && listParameter);

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
      returning(database, { label: "updated" }, { minimum }),
      expected,
    );
    assert.deepEqual(cte(database, { minimum }), expected);
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
  assert.deepEqual(window(database), [
    { id: 1, position: 1 },
    { id: 2, position: 2 },
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
