import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import {
  accessFixture,
  assertionHeader,
  mcpSession,
  requestedWith,
  signAccessToken,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { planDay } from "./support/plan-day.ts";

const day = "2026-01-01";
const instant = `${day}T00:00:00.000Z`;
const menu = {
  name: "Example noodle bowl",
  restaurant: "Example cafe",
  baseline: "menu",
  source: "Example menu",
  kcal: 500,
  protein_g: 30,
};

async function setup(context: TestContext) {
  const fixture = accessFixture(context);
  const headers = {
    ...requestedWith,
    ...assertionHeader(await signAccessToken()),
  };
  const request = async (path: string, init: RequestInit = {}) =>
    fixture.app.request(path, { ...init, headers });
  const send = async (
    path: string,
    body?: unknown,
    status = 200,
    method = "POST",
  ) => {
    const response = await request(
      path,
      body === undefined ? {} : { method, body: JSON.stringify(body) },
    );
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  };
  const save = async (
    body: unknown = { action: "create", ...menu },
    status = 201,
  ) => (await send("/api/regular-meals", body, status)).meal;
  const log = async (body: unknown, status = 201) =>
    send("/api/intake", body, status);
  const patch = async (id: number, body: unknown, status = 200) =>
    send(`/api/intake/${id}`, body, status, "PATCH");
  return { ...fixture, request, send, save, log, patch };
}

test("a tag-only edit on a signed-off day keeps signed_off_at", async (context) => {
  const harness = await setup(context);
  const { admin, database, request, send, save, log, patch } = harness;
  await planDay(database, { user: admin, request }, "UTC");
  const meal = await save();
  const { entry } = await log({
    client_id: "signed-meal",
    food_id: meal.id,
    servings: 1,
  });
  const signed = await send("/api/days/sign-off", { day });
  assert.equal(signed.signed_off_at, instant);
  const snapshot = async () => {
    const daily = await send(`/api/days/${day}`);
    const today = await send("/api/today");
    return {
      signed_off_at: daily.signed_off_at,
      totals: daily.totals,
      target: today.target,
      results: database.prepare("SELECT * FROM target_results").all(),
    };
  };
  const before = await snapshot();
  assert.equal(before.target.status, "ready");
  const cleared = await patch(entry.id, { eating_out: false });
  assert.equal((await snapshot()).signed_off_at, instant);
  assert.equal(cleared.entry.updated_at, entry.updated_at);
  assert.equal(cleared.entry.eating_out, 0);
  assert.equal(cleared.stock, undefined);
  const client = await mcpSession(context, harness, admin.id);
  const tool = {
    name: "edit_intake",
    arguments: { id: entry.id, eating_out: true },
  };
  for (const attempt of ["toggle", "repeat"]) {
    const result = await client.callTool(tool);
    const body = result.structuredContent as { entry: { eating_out: number } };
    assert.equal(body.entry.eating_out, 1, attempt);
    assert.deepEqual(await snapshot(), before);
  }
  await patch(entry.id, { portion_note: "Example note" });
  assert.equal((await snapshot()).signed_off_at, null);
});

test("restaurant defaults, first write wins, and a resnapshot rechecks the replacement basis", async (context) => {
  const { save, log, send, patch } = await setup(context);
  const meal = await save();
  const regular = { id: meal.id, eaten_at: instant, client_id: "regular" };
  for (const [eating_out, expected] of [
    [undefined, 1],
    [false, 0],
  ] as const) {
    const args = { ...regular, client_id: `regular-${expected}`, eating_out };
    const { entry } = await send("/api/regular-meals/log", args, 201);
    assert.equal(entry.eating_out, expected);
  }
  const estimate = {
    food_id: meal.id,
    servings: 1,
    amount_estimated: true,
    client_id: "estimated-menu",
  };
  const first = (await log(estimate)).entry;
  assert.deepEqual(
    [first.kcal_basis, first.eating_out, first.provenance],
    ["menu", 1, "estimated"],
  );
  const args = {
    ...estimate,
    client_id: "estimated-cleared",
    eating_out: false,
  };
  const { entry: manuallyCleared } = await log(args);
  const measured = await patch(manuallyCleared.id, { amount_measured: true });
  assert.equal(measured.entry.eating_out, 0);
  const { restaurant, ...mealValues } = menu;
  const update = {
    ...mealValues,
    action: "update",
    id: meal.id,
    baseline: "label",
  };
  assert.equal((await save(update, 200)).restaurant, restaurant);
  assert.deepEqual(
    (await log({ ...estimate, eating_out: false }, 200)).entry,
    first,
  );
  const range = { servings_low: 0.5, servings_high: 1.5 };
  assert.deepEqual(await patch(first.id, { ...range, eating_out: true }, 400), {
    error: { code: "eating_out_not_allowed" },
  });
  assert.deepEqual((await log(estimate, 200)).entry, first);
  const replaced = (await patch(first.id, range)).entry;
  assert.deepEqual(
    [replaced.kcal_basis, replaced.eating_out, replaced.can_tag_eating_out],
    ["label", 0, false],
  );
  const updated = await save({ ...update, restaurant: null }, 200);
  assert.equal(updated.restaurant, null);
});

test("package and label identity excludes direct and copied foods and survives ad hoc edits", async (context) => {
  const { database, admin, log, patch } = await setup(context);
  const source = database.prepare(`INSERT INTO source_foods
    (source, source_key, name, kcal, provenance, fetched_at, barcode)
    VALUES (?, ?, 'Example source food', 250, ?, ?, ?) RETURNING id`);
  const copy = database.prepare(`INSERT INTO foods
    (user_id, name, kcal, provenance, source_food_id)
    VALUES (?, 'Example copy', 250, 'estimated', ?) RETURNING id`);
  for (const [provider, key, provenance, barcode, allowed] of [
    ["off", "12345670", "label", "12345670", false],
    ["usda", "example-branded", "label", null, false],
    ["usda", "example-foundation", "verified", null, true],
  ] as const) {
    const { id } = source.get(provider, key, provenance, instant, barcode) as {
      id: number;
    };
    const owned = copy.get(admin.id, id) as { id: number };
    for (const reference of [{ source_food_id: id }, { food_id: owned.id }]) {
      const args = {
        ...reference,
        client_id: `${key}-${Object.keys(reference)[0]}`,
        servings: 1,
        eating_out: true,
      };
      if (allowed) {
        const { entry } = await log(args);
        assert.deepEqual([entry.kcal_basis, entry.eating_out], ["other", 1]);
      } else {
        assert.deepEqual(await log(args, 400), {
          error: { code: "eating_out_not_allowed" },
        });
      }
    }
    if (allowed) {
      database
        .prepare("UPDATE foods SET provenance = 'label' WHERE id = ?")
        .run(owned.id);
      await log(
        {
          food_id: owned.id,
          servings: 1,
          client_id: "copied-label",
          eating_out: true,
        },
        400,
      );
    }
  }

  const adhoc = { name: "Example meal", kcal: 100 };
  for (const identity of [
    { packaged_food: true },
    { provenance: "label", source: "Example label" },
  ]) {
    const client_id = Object.keys(identity)[0];
    const { entry } = await log({ ...adhoc, ...identity, client_id });
    const { entry: changed } = await patch(entry.id, { kcal: 110 });
    assert.equal(changed.packaged_food, entry.packaged_food);
    assert.equal(changed.kcal_basis, entry.kcal_basis);
    assert.equal(changed.can_tag_eating_out, false);
    await patch(entry.id, { eating_out: true }, 400);
  }
  const packageClaim = { ...adhoc, packaged_food: true, kcal_basis: "menu" };
  await log({ ...packageClaim, client_id: "impossible-menu" }, 400);
  const { entry: legacyLabel } = await log({
    ...adhoc,
    client_id: "legacy-label",
    provenance: "label",
    source: "Example label",
  });
  database
    .prepare("UPDATE intake_entries SET kcal_basis = 'legacy' WHERE id = ?")
    .run(legacyLabel.id);
  await patch(legacyLabel.id, { protein_g: 5 });
  await patch(legacyLabel.id, { eating_out: true }, 400);

  const { entry: manual } = await log({
    ...adhoc,
    client_id: "old-queued-shape",
    eating_out: true,
  });
  assert.equal(manual.kcal_basis, "other");
  for (const invalid of [
    { kcal_basis: "menu" },
    { kcal_basis: "menu", kcal: null },
    { kcal_basis: "legacy", kcal: 100 },
    { eating_out: null },
    {},
  ])
    await patch(manual.id, invalid, 400);
  const { entry: corrected } = await patch(manual.id, {
    kcal_basis: "menu",
    kcal: 100,
  });
  assert.equal(corrected.kcal_basis, "menu");
  const { entry: macros } = await patch(manual.id, { protein_g: 5 });
  assert.deepEqual([macros.kcal_basis, macros.eating_out], ["menu", 1]);
  const labelClaim = {
    protein_g: 6,
    provenance: "label",
    source: "Example label",
  };
  await patch(manual.id, { ...labelClaim, eating_out: true }, 400);
  const cleared = await patch(manual.id, { eating_out: false });
  assert.equal(cleared.entry.kcal_basis, "menu");
  await patch(manual.id, { eating_out: true });
  const relabeled = (await patch(manual.id, labelClaim)).entry;
  assert.deepEqual([relabeled.kcal_basis, relabeled.eating_out], ["label", 0]);
});

test("planned restaurant logs accept overrides, preserve receipts, and reject overrides on skip", async (context) => {
  const { database, admin, request, send, save } = await setup(context);
  await planDay(database, { user: admin, request }, "UTC");
  const meal = await save();
  const apply = (input: unknown, status = 200) =>
    send("/api/plan/items/action", input, status);
  for (const [position, override, expected] of [
    [0, undefined, 1],
    [1, false, 0],
  ] as const) {
    const args = { position, food_id: meal.id };
    const { item } = await send("/api/plan/slot", args, 201);
    const action = {
      item_id: item.id,
      revision: item.revision,
      action: "ate",
      mutation_id: `planned-${position}`,
    };
    await apply({ ...action, action: "skip", eating_out: false }, 400);
    const first = await apply({ ...action, eating_out: override });
    assert.equal(first.entry.eating_out, expected);
    assert.deepEqual(await apply({ ...action, eating_out: !expected }), first);
    const { can_tag_eating_out: eligible, ...saved } = first.entry;
    assert.equal(eligible, true);
    const receipt = database
      .prepare("SELECT result FROM meal_actions WHERE mutation_id = ?")
      .pluck();
    const old = JSON.parse(String(receipt.get(action.mutation_id)));
    assert.deepEqual(old.entry, saved);
    const legacy = { ...saved };
    for (const key of ["eating_out", "kcal_basis", "packaged_food"])
      delete legacy[key];
    const oldJson = JSON.stringify({ ...old, entry: legacy });
    database
      .prepare("UPDATE meal_actions SET result = ? WHERE mutation_id = ?")
      .run(oldJson, action.mutation_id);
    const { entry } = await apply(action);
    assert.deepEqual(
      [entry.eating_out, entry.kcal_basis, entry.packaged_food],
      [0, "legacy", 0],
    );
    assert.equal(receipt.get(action.mutation_id), oldJson);
  }
});

test("archived legacy tags can be restored after clearing", async (context) => {
  const { database, save, log, patch } = await setup(context);
  const { id } = await save();
  const { entry } = await log({
    client_id: "history",
    food_id: id,
    servings: 1,
  });
  database
    .prepare("UPDATE intake_entries SET kcal_basis = 'legacy' WHERE id = ?")
    .run(entry.id);
  await save({ action: "delete", id }, 200);
  for (const eating_out of [false, true]) {
    const toggled = (await patch(entry.id, { eating_out })).entry;
    assert.equal(toggled.eating_out, Number(eating_out));
    assert.equal(toggled.kcal_basis, "legacy");
  }
  const key = "00000000-0000-4000-8000-000000000001";
  database
    .prepare("UPDATE intake_entries SET client_id = ? WHERE id = ?")
    .run(`meal-part:${key}:1`, entry.id);
  database
    .prepare(`INSERT INTO meal_receipts (user_id, client_id, part_key, request_hash, part_count, created_at)
    VALUES (?, 'example-parts', ?, printf('%064d', 0), 1, ?)`)
    .run(entry.user_id, key, instant);
  await patch(entry.id, { eating_out: true }, 400);
});
