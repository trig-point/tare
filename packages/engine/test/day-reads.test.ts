import assert from "node:assert/strict";
import { readLedger } from "../src/days/ledger.ts";
import { writeTransaction } from "../src/db.ts";
import { insertIntake } from "../src/logging/intake.ts";
import { numbersFrom } from "../src/logging/schemas.ts";
import {
  assertionHeader,
  fixture,
  requestedWith,
  signAccessToken,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

test("ledger totals distinguish complete, partial, empty and all-unknown snapshots", (context) => {
  const { database, admin } = fixture(context);
  database
    .prepare(
      "INSERT INTO foods (user_id, name, kcal, protein_g, carbs_g, fat_g, provenance, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(admin.id, "Example portion", 100, 10, 20, 3, "label", "Example box");
  const clock = { now: () => new Date("2026-01-02T12:00:00.000Z") };
  const log = (input: Parameters<typeof insertIntake>[2]) =>
    writeTransaction(database, (scope) =>
      insertIntake(scope, admin, input, clock),
    );
  const first = log({
    client_id: "catalog",
    reference: { kind: "food", id: 1 },
    servings: 2,
    claim: {},
  }).entry;
  const second = log({
    client_id: "typed",
    name: "Example bite",
    numbers: numbersFrom({
      kcal: 50,
      protein_g: 5,
      carbs_g: 2,
      fat_g: 1,
      fiber_g: 2,
    }),
    claim: {},
  }).entry;
  database.prepare("UPDATE foods SET kcal = ? WHERE id = ?").run(999, 1);
  const ledger = readLedger(database, admin.id, first.day);
  assert.deepEqual(ledger.entries, [first, second]);
  for (const [key, total, complete, known_subtotal] of [
    ["kcal", 250, true, 250],
    ["protein_g", 25, true, 25],
    ["carbs_g", 42, true, 42],
    ["fat_g", 7, true, 7],
    ["fiber_g", null, false, 2],
  ] as const)
    assert.deepEqual(ledger.totals[key], { total, complete, known_subtotal });
  const empty = readLedger(database, admin.id, "2026-01-03");
  assert.deepEqual(empty.entries, []);
  for (const total of Object.values(empty.totals))
    assert.deepEqual(total, { total: 0, complete: true, known_subtotal: 0 });
  database
    .prepare(
      "UPDATE intake_entries SET kcal = NULL, protein_g = NULL, carbs_g = NULL, fat_g = NULL, fiber_g = NULL WHERE user_id = ?",
    )
    .run(admin.id);
  for (const total of Object.values(
    readLedger(database, admin.id, first.day).totals,
  ))
    assert.deepEqual(total, {
      total: null,
      complete: false,
      known_subtotal: 0,
    });
});

for (const mode of ["fallback", "access"] as const)
  test(`day reads preserve the boundary, exact matches and ownership in ${mode}`, async (context) => {
    const { app, database, admin, member, setNow } = await twoUsers(
      context,
      mode,
    );
    const send = async (person: typeof admin, path: string, body?: unknown) => {
      const response = await person.request(
        path,
        body === undefined
          ? {}
          : { method: "POST", body: JSON.stringify(body) },
      );
      assert.equal(response.status, 200);
      return response.json();
    };
    const find = (person: typeof admin, name: string, brand?: string) =>
      send(person, "/api/foods/find", { name, brand });
    const noMatch = { result: "no_match", foods: [] };
    const food = database.prepare(
      "INSERT INTO foods (user_id, name, serving_size, serving_unit, kcal, provenance) VALUES (?, ?, ?, ?, ?, ?)",
    );
    food.run(admin.user.id, "Example Straße", 1, "portion", 100, "estimated");
    food.run(admin.user.id, "Example no basis", null, null, 100, "estimated");
    database
      .prepare(
        "INSERT INTO source_foods (source, source_key, name, brand, serving_size, serving_unit, kcal, provenance, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "off",
        "example-key",
        "Example shared",
        "Example brand",
        100,
        "g",
        80,
        "label",
        "2026-01-01T00:00:00.000Z",
      );
    const network = context.mock.method(globalThis, "fetch", async () => {
      throw new Error("Unexpected network request");
    });
    await assert.rejects(
      fetch("https://example.invalid"),
      /Unexpected network/,
    );
    network.mock.resetCalls();
    const own = await find(admin, " EXAMPLE STRASSE ");
    assert.deepEqual(
      [own.result, own.foods[0].reference, own.foods[0].nutrients.kcal],
      [
        "match",
        { kind: "food", id: 1 },
        { amount: 100, provenance: "estimated" },
      ],
    );
    for (const name of ["Example Stra", "Example no basis"])
      assert.deepEqual(await find(admin, name), noMatch);
    assert.deepEqual(await find(member, "Example Straße"), noMatch);
    const cached = await find(member, "EXAMPLE SHARED", "EXAMPLE BRAND");
    assert.deepEqual(
      [cached.result, cached.foods[0].reference, cached.foods[0].serving],
      [
        "match",
        { kind: "source_food", id: 1 },
        { dimension: "mass", amount: 100, unit: "g" },
      ],
    );
    assert.deepEqual(
      await find(admin, "Example shared", "Wrong brand"),
      noMatch,
    );
    food.run(admin.user.id, "Example Straße", 1, "portion", 200, "estimated");
    assert.deepEqual(await find(admin, "Example Straße"), {
      result: "ambiguous",
      foods: [],
    });
    for (const body of [
      {},
      { name: " " },
      { name: 42 },
      { name: "Example shared", brand: "" },
      { name: "Example shared", user_id: admin.user.id },
    ]) {
      const response = await member.request("/api/foods/find", {
        method: "POST",
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
    }
    assert.equal(network.mock.callCount(), 0);
    database
      .prepare("UPDATE users SET timezone = ? WHERE id IN (?, ?)")
      .run("Asia/Dubai", admin.user.id, member.user.id);
    const boundaryStart = "2025-12-31T23:59:59.000Z";
    if (mode === "access")
      for (const person of [admin, member]) {
        const headers = assertionHeader(
          await signAccessToken({
            email: person.credentials.email,
            iat: Date.parse(boundaryStart) / 1000,
          }),
        );
        person.request = async (path, init = {}) =>
          app.request(path, {
            ...init,
            headers: { ...headers, ...requestedWith },
          });
      }
    setNow(boundaryStart);
    const logged = await admin.request("/api/intake", {
      method: "POST",
      body: JSON.stringify({
        client_id: "before",
        food_id: own.foods[0].reference.id,
        servings: 2,
      }),
    });
    assert.equal(logged.status, 201);
    const { entry } = await logged.json();
    const before = await send(admin, "/api/today");
    assert.deepEqual(
      [before.day, before.entries, before.totals.kcal.total],
      ["2025-12-31", [entry], 200],
    );
    assert.deepEqual((await send(member, "/api/today")).entries, []);
    setNow("2026-01-01T00:00:00.000Z");
    const after = await send(admin, "/api/today");
    assert.deepEqual(
      [after.day, after.entries, after.totals.kcal.total],
      ["2026-01-01", [], 0],
    );
  });
