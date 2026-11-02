import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkRecord,
  checkValues,
  NUTRIENT_UNITS,
  type Nutrients,
  type NutritionRecord,
  type ServingBasis,
  uniformProvenance,
} from "../src/index.ts";

export const unknown: Nutrients = {
  kcal: null,
  protein_g: null,
  carbs_g: null,
  fat_g: null,
  fiber_g: null,
};
export const record: NutritionRecord = {
  source: "usda",
  sourceId: "42",
  name: "Example cloud crisps",
  brand: null,
  barcode: "0012345678901",
  labelSource: null,
  retrievedAt: "2024-02-29T12:34:56.789Z",
  mealKit: null,
  basis: { dimension: "mass", amount: 100, unit: "g" },
  nutrients: { ...unknown, kcal: { amount: 0, provenance: "verified" } },
};

test("USDA verified passes integrity checks; known zero and unknown are distinct", () => {
  assert.deepEqual(checkRecord(record), []);
  assert.deepEqual(NUTRIENT_UNITS, {
    kcal: "kcal",
    protein_g: "g",
    carbs_g: "g",
    fat_g: "g",
    fiber_g: "g",
  });
  assert.deepEqual(
    checkValues({
      source: record.source,
      basis: null,
      nutrients: record.nutrients,
    }),
    [],
  );
  assert.equal(uniformProvenance(record.nutrients), "verified");
  assert.deepEqual(uniformProvenance(unknown), { mixed: [] });
});

test("values reject all unknown, negative, nonfinite and verified non-USDA nutrients", () => {
  assert.deepEqual(checkValues({ ...record, nutrients: unknown }), [
    { code: "no_known_value" },
  ]);
  for (const amount of [
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])
    assert.deepEqual(
      checkRecord({
        ...record,
        nutrients: { ...unknown, kcal: { amount, provenance: "verified" } },
      }),
      [{ code: "invalid_amount", nutrient: "kcal" }],
    );
  for (const source of ["off", "own"] as const)
    assert.deepEqual(checkRecord({ ...record, source }), [
      { code: "verified_source", nutrient: "kcal" },
    ]);
});

test("record identity, barcode and canonical external retrieval times are checked", () => {
  for (const timestamp of [
    null,
    "",
    "2024-02-29",
    "2024-02-29T12:34:56Z",
    "2024-02-30T12:34:56.789Z",
    "2024-13-01T12:34:56.789Z",
  ])
    assert.deepEqual(checkRecord({ ...record, retrievedAt: timestamp }), [
      { code: "invalid_retrieved_at" },
    ]);
  for (const barcode of ["abcd1234", "1234567", "123456789012345", " 12345678"])
    assert.deepEqual(checkRecord({ ...record, barcode }), [
      { code: "invalid_barcode" },
    ]);
  assert.deepEqual(checkRecord({ ...record, sourceId: " " }), [
    { code: "empty_source_id" },
  ]);
  assert.deepEqual(checkRecord({ ...record, name: "" }), [
    { code: "empty_name" },
  ]);
  assert.deepEqual(checkRecord({ ...record, barcode: null }), []);
  assert.deepEqual(
    checkRecord({
      ...record,
      source: "own",
      retrievedAt: null,
      nutrients: { ...unknown, kcal: { amount: 0, provenance: "label" } },
    }),
    [],
  );
});

test("basis requires a positive finite amount and nonempty unreserved count unit", () => {
  for (const amount of [
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])
    assert.deepEqual(
      checkRecord({
        ...record,
        basis: { dimension: "mass", amount, unit: "g" },
      }),
      [{ code: "invalid_basis_amount" }],
    );
  for (const unit of ["", " ", "g", "kg", "oz", "lb", "ml", "l", "fl_oz"])
    assert.deepEqual(
      checkRecord({
        ...record,
        basis: { dimension: "count", amount: 1, unit },
      }),
      [{ code: "invalid_count_unit" }],
    );
  for (const basis of [
    null,
    { dimension: "count", amount: 1, unit: "bar" },
  ] satisfies (ServingBasis | null)[])
    assert.deepEqual(checkRecord({ ...record, basis }), []);
});

test("meal kits belong to own foods and require nonempty identity fields", () => {
  const mealKit = {
    service: "Example Kitchen",
    mealName: "Cloud Bowl",
    chef: null,
  };
  assert.deepEqual(checkRecord({ ...record, mealKit }), [
    { code: "meal_kit_source" },
  ]);
  const own: NutritionRecord = {
    ...record,
    source: "own",
    mealKit,
    nutrients: { ...unknown, kcal: { amount: 1, provenance: "label" } },
  };
  assert.deepEqual(checkRecord(own), []);
  for (const invalid of [
    { ...mealKit, service: " " },
    { ...mealKit, mealName: "" },
    { ...mealKit, chef: "" },
    { ...mealKit, chef: "\u00a0" },
  ])
    assert.deepEqual(checkRecord({ ...own, mealKit: invalid }), [
      { code: "empty_meal_kit_field" },
    ]);
});
