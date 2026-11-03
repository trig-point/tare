import assert from "node:assert/strict";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

for (const mode of ["fallback", "access"] as const)
  test(`regular meals preserve snapshots, provenance, archives and ownership in ${mode}`, async (context) => {
    const { database, admin, member } = await twoUsers(context, mode);
    const send = async (
      person: typeof admin,
      path: string,
      body: unknown,
      status = 200,
    ) => {
      const response = await person.request(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const result = await response.json();
      assert.equal(response.status, status, JSON.stringify(result));
      return result;
    };
    const save = (body: unknown, status = 200, person = admin) =>
      send(person, "/api/regular-meals", body, status);
    const find = (person = admin) =>
      send(person, "/api/foods/find", { name: "  EXAMPLE STRASSE BOWL " });
    const noMatch = { result: "no_match", foods: [] };
    const values = {
      name: "Example Straße bowl",
      restaurant: "Example cafe",
      kcal: 500,
      protein_g: 30,
      kcal_low: 450,
      kcal_high: 550,
      baseline: "menu",
      source: "Example cafe menu",
    };
    assert.deepEqual(await find(), noMatch);
    const { meal } = await save({ action: "create", ...values }, 201);
    assert.equal(meal.provenance, "label");
    assert.equal(meal.source, values.source);
    assert.deepEqual((await find()).foods[0].reference, {
      kind: "food",
      id: meal.id,
    });
    assert.deepEqual(await find(member), noMatch);
    const log = {
      id: meal.id,
      client_id: "example-meal",
      eaten_at: "2026-01-01T00:00:00.000Z",
    };
    const first = await send(admin, "/api/regular-meals/log", log, 201);
    assert.equal(first.created, true);
    assert.equal(first.entry.food_id, meal.id);
    assert.equal(first.entry.servings, 1);
    for (const [key, expected] of Object.entries({
      kcal: 500,
      protein_g: 30,
      kcal_low: 450,
      kcal_high: 550,
      fiber_g: null,
      provenance: "label",
      source: values.source,
    }))
      assert.equal(first.entry[key], expected);
    const edited = {
      ...values,
      name: "Example revised bowl",
      restaurant: null,
      kcal: 600,
      kcal_low: 500,
      kcal_high: 700,
      baseline: "estimate",
      source: undefined,
    };
    const updated = (await save({ action: "update", id: meal.id, ...edited }))
      .meal;
    assert.equal(updated.id, meal.id);
    assert.equal(updated.restaurant, null);
    assert.equal(updated.provenance, "estimated");
    assert.equal(updated.source, null);
    assert.deepEqual(await send(admin, "/api/regular-meals/log", log), {
      ...first,
      created: false,
    });
    const second = await send(
      admin,
      "/api/regular-meals/log",
      { ...log, client_id: "example-after-edit" },
      201,
    );
    assert.equal(second.entry.kcal, 600);
    assert.equal(second.entry.kcal_low, 500);
    assert.equal(second.entry.kcal_high, 700);
    assert.equal(second.entry.provenance, "estimated");
    assert.equal(second.entry.fiber_g, null);
    await send(
      member,
      "/api/intake",
      { client_id: log.client_id, name: "Example snack", kcal: 20 },
      201,
    );
    const snapshot = () =>
      ["foods", "regular_meals", "intake_entries"].map((table) =>
        database.prepare(`SELECT * FROM ${table}`).all(),
      );
    const before = snapshot();
    for (const client_id of [log.client_id, "unused-client"])
      assert.deepEqual(
        await send(
          member,
          "/api/regular-meals/log",
          { ...log, client_id },
          404,
        ),
        { error: { code: "not_found" } },
      );
    for (const action of ["update", "delete"])
      assert.deepEqual(
        await save({ ...values, action, id: meal.id }, 404, member),
        { error: { code: "not_found" } },
      );
    assert.deepEqual(snapshot(), before);
    for (const invalid of [
      { name: " " },
      { source: " " },
      { baseline: "label", source: undefined },
      { provenance: "verified" },
      { protein_g: undefined },
      { kcal_high: undefined },
      { kcal_low: 600 },
      { kcal: -1 },
    ])
      await save({ action: "create", ...values, ...invalid }, 400);
    await save({}, 400);
    await save({ action: "delete" }, 400);
    await send(
      admin,
      "/api/regular-meals/log",
      { ...log, eaten_at: "invalid", client_id: "bad-time" },
      400,
    );
    assert.deepEqual(snapshot(), before);
    await save({ action: "update", id: meal.id, ...values });
    assert.equal((await find()).result, "match");
    assert.deepEqual(await save({ action: "delete", id: meal.id }), {
      deleted: true,
    });
    assert.deepEqual(await find(), noMatch);
    for (const action of ["update", "delete"])
      await save({ ...values, action, id: meal.id }, 404);
    await send(admin, "/api/regular-meals/log", log, 404);
    assert.equal(
      database
        .prepare<[number], { archived_at: string | null }>(
          "SELECT archived_at FROM regular_meals WHERE food_id = ?",
        )
        .get(meal.id)?.archived_at,
      "2026-01-01T00:00:00.000Z",
    );
    assert.equal(
      database
        .prepare<[], { count: number }>("SELECT count(*) AS count FROM foods")
        .get()?.count,
      1,
    );
    assert.equal(
      database
        .prepare<[], { count: number }>(
          "SELECT count(*) AS count FROM source_foods",
        )
        .get()?.count,
      0,
    );
    assert.deepEqual(
      (await (await admin.request("/api/today")).json()).entries,
      [first.entry, second.entry],
    );
    assert.throws(
      () =>
        database
          .prepare(
            "INSERT INTO regular_meals (user_id, food_id, baseline, created_at) VALUES (?, ?, ?, ?)",
          )
          .run(member.user.id, meal.id, "estimate", log.eaten_at),
      /FOREIGN KEY/,
    );
  });
