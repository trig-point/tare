import assert from "node:assert/strict";
import {
  checkRecord,
  fromStoredNutrition,
  type NutritionRecord,
  type NutritionValues,
  toStoredNutrition,
} from "@tare/nutrition";
import { openDatabase } from "../src/db.ts";
import { insertFood } from "../src/queries/insert-food.ts";
import { insertSourceFood } from "../src/queries/insert-source-food.ts";
import { insertUser } from "../src/queries/insert-user.ts";
import { selectFood } from "../src/queries/select-food.ts";
import { selectSourceFood } from "../src/queries/select-source-food.ts";
import { test } from "./support/hang-ceiling.ts";

test("nutrition mapping crosses SQLite source_foods and new own foods without losing NULL or zero", (context) => {
  const connection = openDatabase(":memory:");
  context.after(connection.close);
  const database = connection.database;
  const timestamp = "2024-02-29T12:34:56.789Z";
  const record: NutritionRecord = {
    source: "usda",
    sourceId: "42",
    name: "Example cloud crisps",
    brand: null,
    barcode: null,
    labelSource: null,
    retrievedAt: timestamp,
    mealKit: null,
    basis: { dimension: "mass", amount: 100, unit: "g" },
    nutrients: {
      kcal: { amount: 0, provenance: "verified" },
      protein_g: null,
      carbs_g: null,
      fat_g: null,
      fiber_g: null,
    },
  };
  const mapped = toStoredNutrition(record, "source_food");
  assert.ok(mapped.ok);
  const inserted = insertSourceFood(database, {
    ...mapped.row,
    source: record.source,
    source_key: record.sourceId,
    name: record.name,
    brand: record.brand,
    fetched_at: timestamp,
  });
  assert.ok(inserted);
  const cached = selectSourceFood(database, { id: inserted.id });
  assert.ok(cached);
  assert.equal(cached.provenance, "verified");
  assert.equal(cached.kcal, 0);
  assert.equal(cached.fiber_g, null);
  const restored = fromStoredNutrition({ ...cached, provenance: "verified" });
  assert.deepEqual(restored, {
    basis: record.basis,
    nutrients: record.nutrients,
  });
  const user = insertUser(database, {
    username: "sample-nutrition",
    password_hash: "test-hash",
    timezone: "UTC",
    created_at: timestamp,
  });
  assert.ok(user);
  const values: NutritionValues = {
    source: "own",
    basis: null,
    nutrients: {
      ...record.nutrients,
      kcal: { amount: 0, provenance: "estimated" },
    },
  };
  const ownMapped = toStoredNutrition(values, "food");
  assert.ok(ownMapped.ok);
  const food = insertFood(database, {
    ...ownMapped.row,
    user_id: user.id,
    name: "Example moon soup",
    kcal_low: null,
    kcal_high: null,
    source: null,
    source_food_id: null,
  });
  assert.ok(food);
  const identified: NutritionRecord = {
    ...values,
    sourceId: String(food.id),
    name: food.name,
    brand: null,
    barcode: null,
    labelSource: null,
    retrievedAt: null,
    mealKit: null,
  };
  assert.deepEqual(checkRecord(identified), []);
  const selected = selectFood(database, { user_id: user.id, id: food.id });
  assert.ok(selected);
  assert.equal(selected.provenance, "estimated");
  assert.equal(selected.kcal, 0);
  assert.equal(selected.fiber_g, null);
  assert.deepEqual(
    fromStoredNutrition({ ...selected, provenance: "estimated" }),
    { basis: values.basis, nutrients: values.nutrients },
  );
});
