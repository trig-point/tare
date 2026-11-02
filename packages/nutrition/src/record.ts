import { unitDimension } from "./units.ts";

export type Provenance = "verified" | "label" | "estimated";
export type Nutrient = "kcal" | "protein_g" | "carbs_g" | "fat_g" | "fiber_g";
export const NUTRIENT_UNITS = {
  kcal: "kcal",
  protein_g: "g",
  carbs_g: "g",
  fat_g: "g",
  fiber_g: "g",
} as const;
export interface KnownValue {
  readonly amount: number;
  readonly provenance: Provenance;
}
export type NutrientValue = KnownValue | null;
export type Nutrients = { readonly [name in Nutrient]: NutrientValue };
export type MassUnit = "g" | "kg" | "oz" | "lb";
export type VolumeUnit = "ml" | "l" | "fl_oz";
export type ServingBasis =
  | {
      readonly dimension: "mass";
      readonly amount: number;
      readonly unit: MassUnit;
    }
  | {
      readonly dimension: "volume";
      readonly amount: number;
      readonly unit: VolumeUnit;
    }
  | {
      readonly dimension: "count";
      readonly amount: number;
      readonly unit: string;
    };
export interface NutritionValues {
  readonly source: "usda" | "off" | "own";
  readonly basis: ServingBasis | null;
  readonly nutrients: Nutrients;
}
export interface MealKitKey {
  readonly service: string;
  readonly mealName: string;
  readonly chef: string | null;
}
export interface NutritionRecord extends NutritionValues {
  readonly sourceId: string;
  readonly name: string;
  readonly brand: string | null;
  readonly barcode: string | null;
  readonly labelSource: string | null;
  readonly retrievedAt: string | null;
  readonly mealKit: MealKitKey | null;
}
export type RecordIssue =
  | {
      readonly code: "invalid_amount" | "verified_source";
      readonly nutrient: Nutrient;
    }
  | {
      readonly code:
        | "no_known_value"
        | "invalid_basis_amount"
        | "invalid_count_unit"
        | "invalid_retrieved_at"
        | "invalid_barcode"
        | "empty_source_id"
        | "empty_name"
        | "meal_kit_source"
        | "empty_meal_kit_field";
    };

export function checkValues(values: NutritionValues): readonly RecordIssue[] {
  const issues: RecordIssue[] = [];
  let known = 0;
  for (const nutrient of Object.keys(NUTRIENT_UNITS) as Nutrient[]) {
    const value = values.nutrients[nutrient];
    if (value === null) continue;
    known += 1;
    if (!Number.isFinite(value.amount) || value.amount < 0)
      issues.push({ code: "invalid_amount", nutrient });
    if (value.provenance === "verified" && values.source !== "usda")
      issues.push({ code: "verified_source", nutrient });
  }
  if (known === 0) issues.push({ code: "no_known_value" });
  if (values.basis !== null) {
    if (!Number.isFinite(values.basis.amount) || values.basis.amount <= 0)
      issues.push({ code: "invalid_basis_amount" });
    if (
      values.basis.dimension === "count" &&
      (values.basis.unit.trim() === "" ||
        unitDimension(values.basis.unit) !== "count")
    )
      issues.push({ code: "invalid_count_unit" });
  }
  return issues;
}

export function checkRecord(record: NutritionRecord): readonly RecordIssue[] {
  const issues = [...checkValues(record)];
  if (record.sourceId.trim() === "") issues.push({ code: "empty_source_id" });
  if (record.name.trim() === "") issues.push({ code: "empty_name" });
  if (record.barcode !== null && !/^\d{8,14}$/.test(record.barcode))
    issues.push({ code: "invalid_barcode" });
  if (record.mealKit !== null) {
    if (record.source !== "own") issues.push({ code: "meal_kit_source" });
    const { service, mealName, chef } = record.mealKit;
    if (
      service.trim() === "" ||
      mealName.trim() === "" ||
      (chef !== null && chef.trim() === "")
    )
      issues.push({ code: "empty_meal_kit_field" });
  }
  if (record.source !== "own") {
    const timestamp = record.retrievedAt;
    if (
      timestamp === null ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) ||
      !Number.isFinite(Date.parse(timestamp)) ||
      new Date(timestamp).toISOString() !== timestamp
    )
      issues.push({ code: "invalid_retrieved_at" });
  }
  return issues;
}

export function uniformProvenance(
  nutrients: Nutrients,
): Provenance | { readonly mixed: readonly Provenance[] } {
  const classes = new Set<Provenance>();
  for (const nutrient of Object.keys(NUTRIENT_UNITS) as Nutrient[]) {
    const value = nutrients[nutrient];
    if (value !== null) classes.add(value.provenance);
  }
  if (classes.size === 1) {
    for (const provenance of classes) return provenance;
  }
  return { mixed: [...classes] };
}
