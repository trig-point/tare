import {
  checkValues,
  type MassUnit,
  type Nutrients,
  type NutritionValues,
  type Provenance,
  type RecordIssue,
  type ServingBasis,
  uniformProvenance,
  type VolumeUnit,
} from "./record.ts";
import { unitDimension } from "./units.ts";

export type StorageTarget = "source_food" | "food";
export interface StoredNutrition {
  readonly serving_size: number | null;
  readonly serving_unit: string | null;
  readonly kcal: number | null;
  readonly protein_g: number | null;
  readonly carbs_g: number | null;
  readonly fat_g: number | null;
  readonly fiber_g: number | null;
  readonly provenance: Provenance;
}
export type StoreResult =
  | { readonly ok: true; readonly row: StoredNutrition }
  | {
      readonly ok: false;
      readonly reason: "invalid_record";
      readonly issues: readonly RecordIssue[];
    }
  | {
      readonly ok: false;
      readonly reason: "mixed_provenance";
      readonly classes: readonly Provenance[];
    }
  | {
      readonly ok: false;
      readonly reason: "provenance_not_allowed";
      readonly target: StorageTarget;
      readonly provenance: Provenance;
    };

const ALLOWED: Record<StorageTarget, readonly Provenance[]> = {
  source_food: ["verified", "label"],
  food: ["label", "estimated"],
};

export function toStoredNutrition(
  values: NutritionValues,
  target: StorageTarget,
): StoreResult {
  const issues = checkValues(values);
  if (issues.length > 0) return { ok: false, reason: "invalid_record", issues };
  const provenance = uniformProvenance(values.nutrients);
  if (typeof provenance !== "string")
    return { ok: false, reason: "mixed_provenance", classes: provenance.mixed };
  if (!ALLOWED[target].includes(provenance))
    return { ok: false, reason: "provenance_not_allowed", target, provenance };
  const amount = (nutrient: keyof Nutrients) => {
    const value = values.nutrients[nutrient];
    return value === null ? null : value.amount;
  };
  return {
    ok: true,
    row: {
      serving_size: values.basis === null ? null : values.basis.amount,
      serving_unit: values.basis === null ? null : values.basis.unit,
      kcal: amount("kcal"),
      protein_g: amount("protein_g"),
      carbs_g: amount("carbs_g"),
      fat_g: amount("fat_g"),
      fiber_g: amount("fiber_g"),
      provenance,
    },
  };
}

export function fromStoredNutrition(row: StoredNutrition): {
  basis: ServingBasis | null;
  nutrients: Nutrients;
} {
  if ((row.serving_size === null) !== (row.serving_unit === null))
    throw new Error("Incomplete serving basis");
  let basis: ServingBasis | null = null;
  if (row.serving_size !== null && row.serving_unit !== null) {
    const dimension = unitDimension(row.serving_unit);
    if (dimension === "mass")
      basis = {
        dimension,
        amount: row.serving_size,
        unit: row.serving_unit as MassUnit,
      };
    else if (dimension === "volume")
      basis = {
        dimension,
        amount: row.serving_size,
        unit: row.serving_unit as VolumeUnit,
      };
    else
      basis = { dimension, amount: row.serving_size, unit: row.serving_unit };
  }
  const value = (amount: number | null) =>
    amount === null ? null : { amount, provenance: row.provenance };
  return {
    basis,
    nutrients: {
      kcal: value(row.kcal),
      protein_g: value(row.protein_g),
      carbs_g: value(row.carbs_g),
      fat_g: value(row.fat_g),
      fiber_g: value(row.fiber_g),
    },
  };
}
