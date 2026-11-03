import assert from "node:assert/strict";
import { updateIntake } from "../src/queries/update-intake.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

test("logging HTTP writes preserve snapshots, replay, ownership and patch semantics", async (context) => {
  const { database, admin, member, setNow } = await twoUsers(
    context,
    "fallback",
  );
  const send = async (
    path: string,
    body: unknown,
    method = "POST",
    other = false,
  ) => {
    const response = await (other ? member : admin).request(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, ...(await response.json()) };
  };
  const log = (client_id: string, extra = {}) => ({
    client_id,
    name: "Example snack",
    kcal: 100,
    ...extra,
  });
  const first = await send("/api/intake", log("same"));
  assert.equal(first.status, 201);
  assert.deepEqual(
    [first.entry.name, first.entry.provenance, first.created],
    ["Example snack", "estimated", true],
  );
  assert.deepEqual(await send("/api/intake", log("same", { kcal: 900 })), {
    status: 200,
    entry: first.entry,
    created: false,
  });
  const other = await send("/api/intake", log("same"), "POST", true);
  assert.notEqual(other.entry.id, first.entry.id);
  for (const [body, code] of [
    [log("bad", { provenance: "verified" }), "verified_not_allowed"],
    [
      {
        client_id: "bad",
        source_food_id: 1,
        servings: 1,
        provenance: "estimated",
      },
      "provenance_mismatch",
    ],
    [
      { client_id: "bad", source_food_id: 1, servings: 1, kcal: 100 },
      "invalid_request",
    ],
    [
      { client_id: "bad", source_food_id: 1, servings: 1, source: "Box" },
      "invalid_request",
    ],
    [log("bad", { name: "x".repeat(9000) }), "body_too_large"],
  ] as const) {
    if (code === "provenance_mismatch")
      database
        .prepare(
          "INSERT INTO source_foods (id, source, source_key, name, kcal, provenance, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          1,
          "usda",
          "example",
          "Example grain",
          80,
          "verified",
          "2026-01-01T00:00:00.000Z",
        );
    const result = await send("/api/intake", body);
    assert.deepEqual(
      [result.status, result.error.code],
      [code === "body_too_large" ? 413 : 400, code],
    );
    assert.equal(
      database
        .prepare("SELECT count(*) FROM intake_entries WHERE client_id = ?")
        .pluck()
        .get("bad"),
      0,
    );
  }
  const catalog = await send("/api/intake", {
    client_id: "catalog",
    source_food_id: 1,
    servings: 2,
  });
  assert.deepEqual(
    [catalog.entry.kcal, catalog.entry.protein_g, catalog.entry.provenance],
    [160, null, "verified"],
  );
  database
    .prepare("UPDATE source_foods SET provenance = ? WHERE id = ?")
    .run("label", 1);
  const replay = await send("/api/intake", {
    client_id: "catalog",
    food_id: 999,
    servings: 3,
  });
  assert.deepEqual([replay.entry, replay.created], [catalog.entry, false]);
  database
    .prepare(
      "INSERT INTO foods (user_id, name, kcal, kcal_low, kcal_high, provenance, source) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      member.user.id,
      "Example portion",
      100,
      90,
      110,
      "label",
      "Example box",
    );
  const foodId = Number(database.prepare("SELECT id FROM foods").pluck().get());
  assert.equal(
    (
      await send("/api/intake", {
        client_id: "foreign",
        food_id: foodId,
        servings: 1,
      })
    ).error.code,
    "food_not_found",
  );
  const own = await send(
    "/api/intake",
    { client_id: "own", food_id: foodId, servings: 2 },
    "POST",
    true,
  );
  assert.deepEqual(
    [own.entry.kcal, own.entry.kcal_low, own.entry.kcal_high],
    [200, 180, 220],
  );
  const weightBody = {
    client_id: "same",
    weight_kg: 70,
    measured_at: "2026-01-01T01:00:00+05:30",
  };
  const weight = await send("/api/weights", weightBody);
  const foreignWeight = await send("/api/weights", weightBody, "POST", true);
  assert.equal(weight.entry.day, "2025-12-31");
  assert.deepEqual(
    await send("/api/weights", { ...weightBody, weight_kg: 90 }),
    { status: 200, entry: weight.entry, created: false },
  );
  const rows = database
    .prepare("SELECT id FROM weights WHERE user_id = ?")
    .all(admin.user.id);
  assert.deepEqual(rows, [{ id: weight.entry.id }]);
  assert.notEqual(foreignWeight.entry.id, weight.entry.id);
  for (const [path, method, body] of [
    [`/api/intake/${other.entry.id}`, "PATCH", { kcal: 500 }],
    [`/api/intake/${other.entry.id}`, "DELETE", undefined],
    [`/api/weights/${foreignWeight.entry.id}`, "PATCH", { weight_kg: 90 }],
    [`/api/weights/${foreignWeight.entry.id}`, "DELETE", undefined],
  ] as const)
    assert.deepEqual(await send(path, body, method), {
      status: 404,
      error: { code: "not_found" },
    });
  assert.deepEqual(
    updateIntake(
      database,
      { ...other.entry, kcal: 500 },
      { user_id: admin.user.id, id: other.entry.id },
    ),
    [],
  );
  const snack = await send(
    "/api/intake",
    log("early", { eaten_at: "2026-01-01T01:00:00+05:30" }),
  );
  assert.equal(snack.entry.day, "2025-12-31");
  database
    .prepare("UPDATE users SET timezone = ? WHERE id = ?")
    .run("America/Los_Angeles", admin.user.id);
  setNow("2026-01-01T06:00:00.000Z");
  const newZone = await send("/api/intake", log("new-zone"));
  assert.equal(newZone.entry.day, "2025-12-31");
  assert.equal(
    database
      .prepare("SELECT day FROM intake_entries WHERE user_id = ? AND id = ?")
      .pluck()
      .get(admin.user.id, first.entry.id),
    first.entry.day,
  );
  const label = await send(
    "/api/intake",
    log("label", {
      provenance: "label",
      source: "Example box",
      portion_note: "Half",
    }),
  );
  database
    .prepare(
      "UPDATE foods SET kcal = ?, kcal_high = ?, name = ?, source = ? WHERE id = ?",
    )
    .run(110, 120, "Example revised portion", "Example revised box", foodId);
  const edits = [
    [label.entry.id, { portion_note: null }, "portion_note", null, false],
    [label.entry.id, { portion_note: "Whole" }, "provenance", "label", false],
    [label.entry.id, { kcal: 120 }, "provenance", "estimated", false],
    [label.entry.id, { kcal: null, protein_g: 4 }, "kcal", null, false],
    [
      first.entry.id,
      { id: other.entry.id, kcal: 125 },
      "id",
      first.entry.id,
      false,
    ],
    [
      snack.entry.id,
      { eaten_at: "2026-01-02T20:00:00Z" },
      "day",
      "2026-01-02",
      false,
    ],
    [own.entry.id, { servings: 3 }, "kcal", 330, true],
  ] as const;
  for (const [id, patch, field, expected, otherPerson] of edits) {
    const result = await send(`/api/intake/${id}`, patch, "PATCH", otherPerson);
    assert.equal(result.status, 200);
    assert.equal(result.entry[field], expected);
    if (otherPerson)
      assert.deepEqual(
        [result.entry.name, result.entry.source, result.entry.kcal_high],
        ["Example revised portion", "Example revised box", 360],
      );
  }
  for (const patch of [
    { kcal_low: 200 },
    { kcal_low: 200, kcal_high: 100 },
    { kcal_low: 1, kcal_high: 2 },
  ])
    assert.deepEqual(
      (await send(`/api/intake/${first.entry.id}`, patch, "PATCH")).error,
      { code: "invalid_bounds" },
    );
  for (const [path, patch, field, value] of [
    [
      `/api/weights/${weight.entry.id}`,
      { body_fat_pct: 20 },
      "body_fat_pct",
      20,
    ],
    [
      `/api/weights/${weight.entry.id}`,
      { body_fat_pct: null, measured_at: "2026-01-02T20:00:00Z" },
      "day",
      "2026-01-02",
    ],
  ] as const)
    assert.equal((await send(path, patch, "PATCH")).entry[field], value);
  assert.equal(
    database
      .prepare("SELECT body_fat_pct FROM weights WHERE id = ?")
      .pluck()
      .get(weight.entry.id),
    null,
  );
  for (const path of [
    `/api/intake/${first.entry.id}`,
    `/api/weights/${weight.entry.id}`,
  ]) {
    assert.equal((await send(path, undefined, "DELETE")).deleted, true);
    assert.equal((await send(path, undefined, "DELETE")).status, 404);
  }
});
