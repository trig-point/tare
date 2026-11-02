import { caseFold } from "unicode-case-folding";
import type { MealKitKey, NutritionRecord } from "./record.ts";

export type IdentityKey =
  | { readonly kind: "barcode"; readonly code: string }
  | {
      readonly kind: "source_id";
      readonly source: "usda" | "off";
      readonly id: string;
    }
  | {
      readonly kind: "name";
      readonly name: string;
      readonly brand: string | null;
    }
  | ({ readonly kind: "meal_kit" } & MealKitKey);

export function foldName(text: string): string {
  return caseFold(text.normalize("NFC").trim()).normalize("NFC");
}

export function sameName(left: string, right: string): boolean {
  return foldName(left) === foldName(right);
}

export function matchesIdentity(
  key: IdentityKey,
  record: NutritionRecord,
): boolean {
  switch (key.kind) {
    case "barcode":
      return key.code === record.barcode;
    case "source_id":
      return key.source === record.source && key.id === record.sourceId;
    case "name":
      return (
        sameName(key.name, record.name) &&
        (key.brand === null ||
          (record.brand !== null && sameName(key.brand, record.brand)))
      );
    case "meal_kit":
      return (
        record.mealKit !== null &&
        sameName(key.service, record.mealKit.service) &&
        sameName(key.mealName, record.mealKit.mealName) &&
        (key.chef === null ||
          (record.mealKit.chef !== null &&
            sameName(key.chef, record.mealKit.chef)))
      );
  }
}
