import type { Database } from "better-sqlite3";
import { OperationError } from "../operations/registry.ts";
import { selectMealAction } from "../queries/orders/select-meal-action.ts";
import { type SelectFoodResult, selectFood } from "../queries/select-food.ts";
import type { SelectIntakeEntryResult } from "../queries/select-intake-entry.ts";
import { selectMealReceiptByPartKey } from "../queries/select-meal-receipt-by-part-key.ts";
import { selectRegularMealFood } from "../queries/select-regular-meal-food.ts";
import {
  type SelectSourceFoodResult,
  selectSourceFood,
} from "../queries/select-source-food.ts";

type SnapshotBasis = "menu" | "label" | "other";
type EntryIdentity = Pick<
  SelectIntakeEntryResult,
  | "id"
  | "user_id"
  | "client_id"
  | "created_at"
  | "food_id"
  | "source_food_id"
  | "kcal_basis"
  | "packaged_food"
  | "provenance"
>;

export function referenceEatingOut(
  database: Database,
  food: SelectFoodResult | SelectSourceFoodResult,
  orderMeal = false,
): { kcal_basis: SnapshotBasis; defaultTag: boolean } {
  const owned = "user_id" in food ? food : null;
  if (
    orderMeal ||
    (owned &&
      (owned.meal_key !== null ||
        (owned.service !== null && owned.meal_name !== null)))
  )
    return { kcal_basis: "label", defaultTag: false };
  const source = !("user_id" in food)
    ? food
    : food.source_food_id === null
      ? null
      : selectSourceFood(database, { id: food.source_food_id });
  if (source)
    return {
      kcal_basis:
        source.source === "off" ||
        source.barcode !== null ||
        source.provenance === "label"
          ? "label"
          : "other",
      defaultTag: false,
    };
  const meal = owned && selectRegularMealFood(database, owned);
  const basis = meal?.baseline ?? food.provenance;
  const kcal_basis = basis === "menu" || basis === "label" ? basis : "other";
  return {
    kcal_basis,
    defaultTag: Boolean(meal?.restaurant?.trim()) && kcal_basis !== "label",
  };
}

export function adHocBasis(
  claim: "menu" | "other" | undefined,
  kcal: number | null,
  label: boolean,
  packaged: boolean,
): SnapshotBasis {
  if (claim !== undefined && (kcal === null || packaged || label))
    throw new OperationError(400, "invalid_kcal_basis");
  return label ? "label" : (claim ?? "other");
}

export function isOrderEntry(database: Database, entry: EntryIdentity) {
  const receipt = selectMealAction(database, {
    user_id: entry.user_id,
    mutation_id: entry.client_id,
  });
  return (
    receipt !== null &&
    receipt.order_meal_id !== null &&
    receipt.intake_entry_id === entry.id &&
    receipt.created_at === entry.created_at
  );
}

function isMealPart(database: Database, entry: EntryIdentity) {
  const match = /^meal-part:(.{36}):([1-9][0-9]*)$/.exec(entry.client_id);
  if (!match?.[1]) return false;
  const receipt = selectMealReceiptByPartKey(database, {
    user_id: entry.user_id,
    part_key: match[1],
  });
  return (
    receipt !== null &&
    receipt.created_at === entry.created_at &&
    Number(match[2]) <= receipt.part_count
  );
}

export function canTagEatingOut(database: Database, entry: EntryIdentity) {
  if (entry.packaged_food === 1 || entry.kcal_basis === "label") return false;
  if (entry.kcal_basis !== "legacy") return true;
  if (entry.food_id === null && entry.source_food_id === null)
    return entry.provenance !== "label";
  if (
    entry.food_id === null ||
    entry.source_food_id !== null ||
    isMealPart(database, entry) ||
    isOrderEntry(database, entry)
  )
    return false;
  const food = selectFood(database, {
    user_id: entry.user_id,
    id: entry.food_id,
  });
  return food !== null && referenceEatingOut(database, food).defaultTag;
}

export function eatingOutValue(
  override: boolean | undefined,
  fallback: boolean,
  eligible: boolean,
): 0 | 1 {
  if (override === true && !eligible)
    throw new OperationError(400, "eating_out_not_allowed");
  return (override ?? fallback) && eligible ? 1 : 0;
}

export function intakeRead<Entry extends EntryIdentity>(
  database: Database,
  entry: Entry,
) {
  return { ...entry, can_tag_eating_out: canTagEatingOut(database, entry) };
}
