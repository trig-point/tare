import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import { shiftDay } from "../logging/day.ts";
import {
  foodChoiceEatingOut,
  foodChoiceFields,
} from "../logging/eating-out.ts";
import { selectUsualFoods } from "../queries/select-usual-foods.ts";

export const usualFoodsWindowDays = 30;
const usualFoodsLimit = 10;

export const usualFoodsOutput = zod.strictObject({
  since: zod.string(),
  foods: zod.array(
    zod.strictObject({
      reference: zod.strictObject({
        kind: zod.enum(["food", "source_food"]),
        id: zod.number().int().positive(),
      }),
      ...foodChoiceFields,
      name: zod.string(),
      brand: zod.string().nullable(),
      times_logged: zod.number().int().positive(),
      usual_servings: zod.number().positive(),
      serving: zod
        .strictObject({ amount: zod.number().positive(), unit: zod.string() })
        .nullable(),
      kcal: zod.number().nullable(),
      protein_g: zod.number().nullable(),
    }),
  ),
});

/** Most-logged foods in the window ending on `day`, with the serving count logged most often. */
export function listUsualFoods(
  database: Database,
  personId: number,
  day: string,
): zod.infer<typeof usualFoodsOutput> {
  const since = shiftDay(day, 1 - usualFoodsWindowDays);
  const rows = selectUsualFoods(database, {
    user_id: personId,
    since,
    until: day,
    limit: usualFoodsLimit,
  });
  return {
    since,
    foods: rows.map((row) => {
      const id = row.food_id ?? row.source_food_id;
      if (id === null || row.name === null)
        throw new Error("Usual food row has no food");
      return {
        reference: { kind: row.food_id !== null ? "food" : "source_food", id },
        ...foodChoiceEatingOut(
          database,
          personId,
          row.food_id,
          row.source_food_id,
        ),
        name: row.name,
        brand: row.brand,
        times_logged: row.times,
        usual_servings: row.servings ?? 1,
        serving:
          row.serving_size === null
            ? null
            : { amount: row.serving_size, unit: row.serving_unit ?? "" },
        kcal: row.kcal,
        protein_g: row.protein_g,
      };
    }),
  };
}
