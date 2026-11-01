import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkValues,
  fromStoredNutrition,
  type NutritionValues,
  type Provenance,
  type ServingBasis,
  type StorageTarget,
  toStoredNutrition,
  uniformProvenance,
} from "../src/index.ts";

function values(provenance: Provenance): NutritionValues {
  return {
    source: provenance === "verified" ? "usda" : "own",
    basis: null,
    nutrients: {
      kcal: { amount: 0, provenance },
      protein_g: { amount: 2, provenance },
      carbs_g: null,
      fat_g: null,
      fiber_g: null,
    },
  };
}
const targets: StorageTarget[] = ["source_food", "food"];

test("storage allows each target's classes and preserves unknown versus zero", () => {
  for (const target of targets) {
    for (const provenance of ["verified", "label", "estimated"] as const) {
      const original = values(provenance);
      const result = toStoredNutrition(original, target);
      if (
        (target === "source_food" && provenance === "estimated") ||
        (target === "food" && provenance === "verified")
      ) {
        assert.deepEqual(result, {
          ok: false,
          reason: "provenance_not_allowed",
          target,
          provenance,
        });
      } else {
        assert.ok(result.ok);
        assert.equal(result.row.kcal, 0);
        assert.equal(result.row.fiber_g, null);
        assert.equal(result.row.provenance, provenance);
        assert.deepEqual(fromStoredNutrition(result.row), {
          basis: original.basis,
          nutrients: original.nutrients,
        });
      }
    }
  }
});

test("mixed provenance is refused for both targets without rewriting values", () => {
  const original: NutritionValues = {
    ...values("label"),
    nutrients: {
      ...values("label").nutrients,
      fiber_g: { amount: 3, provenance: "estimated" },
    },
  };
  const before = structuredClone(original);
  assert.deepEqual(uniformProvenance(original.nutrients), {
    mixed: ["label", "estimated"],
  });
  for (const target of targets)
    assert.deepEqual(toStoredNutrition(original, target), {
      ok: false,
      reason: "mixed_provenance",
      classes: ["label", "estimated"],
    });
  assert.deepEqual(original, before);
});

test("invalid values precede mixed provenance and target checks", () => {
  for (const source of ["off", "own"] as const) {
    const original = { ...values("verified"), source };
    for (const target of targets)
      assert.deepEqual(toStoredNutrition(original, target), {
        ok: false,
        reason: "invalid_record",
        issues: checkValues(original),
      });
  }
  const original: NutritionValues = {
    ...values("label"),
    nutrients: {
      ...values("label").nutrients,
      fiber_g: { amount: -1, provenance: "estimated" },
    },
  };
  for (const target of targets)
    assert.deepEqual(toStoredNutrition(original, target), {
      ok: false,
      reason: "invalid_record",
      issues: [{ code: "invalid_amount", nutrient: "fiber_g" }],
    });
});

test("reader rebuilds every serving dimension, unknown basis and rejects half-NULL pairs", () => {
  const stored = toStoredNutrition(values("label"), "food");
  assert.ok(stored.ok);
  for (const basis of [
    null,
    { dimension: "mass", amount: 100, unit: "g" },
    { dimension: "volume", amount: 250, unit: "ml" },
    { dimension: "count", amount: 1, unit: "bar" },
  ] satisfies (ServingBasis | null)[]) {
    const result = toStoredNutrition({ ...values("label"), basis }, "food");
    assert.ok(result.ok);
    assert.deepEqual(fromStoredNutrition(result.row).basis, basis);
  }
  assert.throws(
    () => fromStoredNutrition({ ...stored.row, serving_size: 1 }),
    /Incomplete serving basis/,
  );
  assert.throws(
    () => fromStoredNutrition({ ...stored.row, serving_unit: "bar" }),
    /Incomplete serving basis/,
  );
});
