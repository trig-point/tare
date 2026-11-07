import assert from "node:assert/strict";
import {
  logFoodInput,
  logWeightInput,
} from "../../../packages/engine/src/logging/schemas.ts";
import {
  editorAfterChange,
  editorPatch,
  inputValue,
  removableFields,
  saveEntry,
} from "../src/outbox-edit.ts";
import type { EntryBody } from "../src/outbox-store.ts";
import { acknowledgement, fixture, person } from "./outbox-support.mts";
import { test } from "./support.mts";

test("Remove preserves engine-required fields and valid intake reference shapes", () => {
  for (const [kind, schema, body] of [
    [
      "weight",
      logWeightInput,
      {
        client_id: "example-weight",
        measured_at: "2026-01-01",
        weight_kg: 70,
        body_fat_pct: 20,
        source: "example",
      },
    ],
    [
      "intake",
      logFoodInput,
      {
        client_id: "example-intake",
        eaten_at: "2026-01-01",
        name: "Example food",
        kcal: 100,
        protein_g: 5,
        kcal_low: 90,
        kcal_high: 110,
        portion_note: "example",
        provenance: "estimated",
      },
    ],
    [
      "intake",
      logFoodInput,
      {
        client_id: "example-reference",
        food_id: 1,
        servings: 1,
        portion_note: "example",
      },
    ],
  ] as const) {
    const fields = removableFields(kind, body);
    for (const field of [
      "weight_kg",
      "client_id",
      "eaten_at",
      "measured_at",
      "name",
      "food_id",
      "source_food_id",
      "servings",
    ])
      assert.equal(fields.has(field), false, field);
    for (const field of Object.keys(body).filter((field) =>
      fields.has(field),
    )) {
      const patched: EntryBody = { ...body };
      delete patched[field];
      assert.equal(schema.safeParse(patched).success, true, field);
    }
  }
  assert.equal(removableFields("intake", { kcal: 100 }).has("kcal"), false);
});

test("changing another entry preserves the open editor and its unsaved input", () => {
  assert.equal(editorAfterChange(1, 2), 1);
  assert.equal(editorAfterChange(1, 1), null);
  assert.equal(editorAfterChange(null, 2), null);
});

test("an unchanged save resends revision zero so a lost acknowledgement drains", async (context) => {
  const { store, replay } = await fixture(context);
  const entry = await store.enqueue("weight", { weight_kg: 70 }, person);
  await store.settle(entry, { error_code: "invalid_request" });
  const [rejected] = await store.entries(person.id);
  assert.ok(rejected);
  const queue = replay({
    fetch: async () => acknowledgement(entry.body, false),
  });
  assert.equal(
    await saveEntry(queue, rejected, {
      weight_kg: 70,
      measured_at: entry.body.measured_at,
      source: undefined,
    }),
    true,
  );
  await queue.wake();
  assert.deepEqual(await store.entries(person.id), []);
});

test("unchanged null text fields stay null and resend while typed null stays text", async (context) => {
  const { store, replay } = await fixture(context);
  const entry = await store.enqueue(
    "intake",
    {
      name: "Example food",
      kcal: 100,
      protein_g: null,
      source: null,
      portion_note: null,
    },
    person,
  );
  await store.settle(entry, { error_code: "invalid_request" });
  const [rejected] = await store.entries(person.id);
  assert.ok(rejected);
  const values = Object.fromEntries(
    Object.entries(entry.body).map(([name, value]) => [
      name,
      inputValue(value),
    ]),
  );
  const patch = editorPatch(entry.body, values);
  assert.deepEqual({ ...patch, client_id: entry.client_id }, entry.body);
  assert.equal(patch.source, null);
  assert.equal(patch.portion_note, null);
  for (const protein of [null, "null"])
    assert.equal(
      removableFields("intake", { ...values, protein_g: protein }).has("kcal"),
      false,
    );
  const typed = editorPatch(entry.body, {
    ...values,
    source: "null",
    portion_note: "null",
  });
  assert.equal(typed.source, "null");
  assert.equal(typed.portion_note, "null");
  const queue = replay({
    fetch: async () => acknowledgement(entry.body, false),
  });
  assert.equal(await saveEntry(queue, rejected, patch), true);
  await queue.wake();
  assert.deepEqual(await store.entries(person.id), []);
});
