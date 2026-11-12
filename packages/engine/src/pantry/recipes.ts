import { z } from "zod";
import type {
  grocyCatalogSchema,
  grocyConversionsSchema,
  grocyFulfillmentSchema,
  grocyRecipePositionsSchema,
  grocyRecipesSchema,
  grocyUnitSchema,
} from "../grocy/client.ts";
import type { ListRecipeLinksResult } from "../queries/pantry/list-recipe-links.ts";

const identifier = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const amount = z.number().finite();
const unit = z.strictObject({
  id: identifier,
  name: z.string().min(1),
  name_plural: z.string().nullable(),
});
const ingredient = z.strictObject({
  recipe_pos_id: identifier,
  product_id: identifier,
  product_name: z.string().min(1),
  nested: z.boolean(),
  child_recipe_id: identifier,
  any_stock: z.boolean(),
  need_fulfilled: z.boolean(),
  amount_unit: unit,
  required_amount: amount,
  missing_amount: amount,
  stock_amount: amount,
  stock_unit: unit,
  display_unit: unit,
  conversion: z.enum(["same_unit", "converted", "conversion_unknown"]),
  display_required_amount: amount.nullable(),
  display_missing_amount: amount.nullable(),
});
export const recipeReference = z.strictObject({
  reference_kind: z.enum(["food", "source_food"]),
  reference_id: identifier,
});
export const recipeLinkInput = recipeReference.extend({
  recipe_id: identifier,
  // A bound keeps scaled nutrients finite, so one link cannot break every recipe read.
  servings: z.number().positive().max(1000),
});
const link = recipeReference.extend({
  servings: z.number().positive().finite(),
  desired_servings_at_link: z.number().positive().finite(),
});
const nutrient = z.number().finite().nonnegative().nullable();
const nutrition = z
  .strictObject({
    status: z.enum(["none", "unresolved", "linked"]),
    link: link.nullable(),
    basis_matches: z.boolean().nullable(),
    nutrients: z
      .strictObject({
        kcal: nutrient,
        protein_g: nutrient,
        carbs_g: nutrient,
        fat_g: nutrient,
        fiber_g: nutrient,
      })
      .nullable(),
  })
  .refine(
    (value) =>
      (value.status === "none") === (value.link === null) &&
      (value.status === "linked") === (value.nutrients !== null),
  );
export const pantryRecipe = z.strictObject({
  recipe_id: identifier,
  name: z.string().min(1),
  desired_servings: z.number().finite().nullable(),
  need_fulfilled: z.boolean(),
  need_fulfilled_with_shopping_list: z.boolean(),
  ingredients: z.array(ingredient),
  nutrition,
});
export const recipeLinkOutput = z.strictObject({
  recipe_id: identifier,
  link,
});
export const recipeLinkRemoval = z.strictObject({
  outcome: z.enum(["deleted", "not_found", "disabled", "reset_required"]),
});
export type Nutrients = NonNullable<z.infer<typeof nutrition>["nutrients"]>;
type Reads = {
  recipes: z.output<typeof grocyRecipesSchema>;
  positions: z.output<typeof grocyRecipePositionsSchema>;
  products: z.output<typeof grocyCatalogSchema>;
  fulfillment: z.output<typeof grocyFulfillmentSchema>;
  units: z.output<typeof grocyUnitSchema>[];
  conversions: z.output<typeof grocyConversionsSchema>;
};

export function recipeNutrition(
  saved: ListRecipeLinksResult | undefined,
  desiredServings: number | null,
  perServing: Nutrients | null,
): z.infer<typeof nutrition> {
  if (!saved)
    return { status: "none", link: null, basis_matches: null, nutrients: null };
  const { recipe_id: _recipe, ...stored } = saved;
  const linked = link.parse(stored);
  const scale = (value: number | null) =>
    value === null ? null : value * linked.servings;
  return {
    status: perServing ? "linked" : "unresolved",
    link: linked,
    basis_matches: desiredServings === linked.desired_servings_at_link,
    nutrients: perServing
      ? {
          kcal: scale(perServing.kcal),
          protein_g: scale(perServing.protein_g),
          carbs_g: scale(perServing.carbs_g),
          fat_g: scale(perServing.fat_g),
          fiber_g: scale(perServing.fiber_g),
        }
      : null,
  };
}

/** Joins Grocy's recipe reads; returns null when any required join is missing. */
export function assembleRecipes(reads: Reads) {
  const recipeIds = new Set(reads.recipes.map((row) => row.id));
  const products = new Map(reads.products.map((row) => [row.id, row]));
  const units = new Map(reads.units.map((row) => [row.id, row]));
  const fulfillment = new Map(
    reads.fulfillment.map((row) => [row.recipe_id, row]),
  );
  const ingredients = new Map<number, z.infer<typeof ingredient>[]>();
  for (const position of reads.positions) {
    const product = products.get(position.product_id);
    const stockUnit = product && units.get(product.qu_id_stock);
    const displayUnit = units.get(position.qu_id);
    if (!recipeIds.has(position.recipe_id) || !stockUnit || !displayUnit)
      return null;
    const anyStock = position.only_check_single_unit_in_stock === 1;
    const amountUnit = anyStock ? displayUnit : stockUnit;
    const factor =
      amountUnit.id === displayUnit.id
        ? 1
        : reads.conversions.find(
            (row) =>
              row.product_id === position.product_id &&
              row.from_qu_id === amountUnit.id &&
              row.to_qu_id === displayUnit.id,
          )?.factor;
    const display = (value: number) =>
      factor === undefined ? null : value * factor;
    const rows = ingredients.get(position.recipe_id) ?? [];
    rows.push({
      recipe_pos_id: position.recipe_pos_id,
      product_id: position.product_id,
      product_name: product.name,
      nested: position.is_nested_recipe_pos === 1,
      child_recipe_id: position.child_recipe_id,
      any_stock: anyStock,
      need_fulfilled: position.need_fulfilled === 1,
      amount_unit: amountUnit,
      required_amount: position.recipe_amount,
      missing_amount: position.missing_amount,
      stock_amount: position.stock_amount,
      stock_unit: stockUnit,
      display_unit: displayUnit,
      conversion:
        amountUnit.id === displayUnit.id
          ? "same_unit"
          : factor === undefined
            ? "conversion_unknown"
            : "converted",
      display_required_amount: display(position.recipe_amount),
      display_missing_amount: display(position.missing_amount),
    });
    ingredients.set(position.recipe_id, rows);
  }
  const assembled = [];
  // Grocy also stores meal plan days and weeks as recipes; only normal ones are recipes to cook.
  for (const row of reads.recipes.filter((row) => row.type === "normal")) {
    const fulfilled = fulfillment.get(row.id);
    if (!fulfilled) return null;
    assembled.push({
      recipe_id: row.id,
      name: row.name,
      desired_servings: row.desired_servings,
      need_fulfilled: fulfilled.need_fulfilled === 1,
      need_fulfilled_with_shopping_list:
        fulfilled.need_fulfilled_with_shopping_list === 1,
      ingredients: ingredients.get(row.id) ?? [],
    });
  }
  return assembled;
}
