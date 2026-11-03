import {
  foldName,
  fromStoredNutrition,
  type NutritionRecord,
  resolveLookup,
  toStoredNutrition,
} from "@tare/nutrition";
import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import { resolveProvenance } from "../logging/provenance.ts";
import { OperationError } from "../operations/registry.ts";
import { insertMealFood } from "../queries/insert-meal-food.ts";
import { selectMealFoodByKey } from "../queries/select-meal-food-by-key.ts";
import { selectMealFoodCandidates } from "../queries/select-meal-food-candidates.ts";
import { selectOpenMealQuestion } from "../queries/select-open-meal-question.ts";
import { selectOrderMealNames } from "../queries/select-order-meal-names.ts";
import { createQuestion, type QuestionKind } from "../questions/kinds.ts";

type Meal = { service: string; name: string; chef: string | null };
const provenanceSchema = zod.enum(["label", "estimated"]);
const nutrient = zod.number().nonnegative();
const labelAnswer = zod
  .strictObject({
    kcal: nutrient,
    protein_g: nutrient,
    carbs_g: nutrient,
    fat_g: nutrient,
    fiber_g: nutrient.optional(),
    source: zod.string().trim().min(1),
  })
  .describe("Label values for one whole meal (1 meal), not per 100 g.");

export function mealKey(meal: Meal): string {
  // JSON escapes control characters, so the unit separator cannot occur in a component.
  return [meal.service, meal.name, meal.chef ?? ""]
    .map((value) => JSON.stringify(foldName(value)))
    .join("\u001f");
}

export const mealNutritionKind: QuestionKind = {
  name: "meal_nutrition",
  answer: labelAnswer,
  apply(database, question, input) {
    if (question.user_id === null)
      throw new Error("Meal question has no owner");
    const [service, name, chef] = zod
      .tuple([zod.string().min(1), zod.string().min(1), zod.string()])
      .parse(
        question.subject_ref.split("\u001f").map((part) => JSON.parse(part)),
      );
    const meal = { service, name, chef: chef === "" ? null : chef };
    if (mealKey(meal) !== question.subject_ref)
      throw new Error("Invalid meal subject");
    const answer = labelAnswer.parse(input);
    const provenance = resolveProvenance(
      { provenance: "label", source: answer.source },
      null,
    );
    const value = (amount: number) => ({ amount, provenance });
    const stored = toStoredNutrition(
      {
        source: "own",
        basis: { dimension: "count", amount: 1, unit: "meal" },
        nutrients: {
          kcal: value(answer.kcal),
          protein_g: value(answer.protein_g),
          carbs_g: value(answer.carbs_g),
          fat_g: value(answer.fat_g),
          fiber_g: answer.fiber_g === undefined ? null : value(answer.fiber_g),
        },
      },
      "food",
    );
    if (!stored.ok) throw new OperationError(400, "invalid_nutrition");
    // Identity stays folded; the display name keeps the casing the person ordered.
    const ordered = selectOrderMealNames(database, {
      user_id: question.user_id,
    }).find((row) => mealKey(row) === question.subject_ref);
    if (
      !insertMealFood(database, {
        ...stored.row,
        ...meal,
        name: ordered?.name.trim() ?? name,
        user_id: question.user_id,
        meal_name: name,
        meal_key: question.subject_ref,
        source: answer.source,
      })
    )
      throw new Error("Meal food insert returned no row");
  },
};

export const mealNutritionKinds: ReadonlyMap<string, QuestionKind> = new Map([
  [mealNutritionKind.name, mealNutritionKind],
]);

export type MealNutritionState =
  | { status: "known"; food_id: number }
  | { status: "pending"; question_id: number }
  | { status: "unknown" };

export function mealNutritionState(
  database: Database,
  userId: number,
  meal: Meal,
): MealNutritionState {
  const pending = selectOpenMealQuestion(database, {
    user_id: userId,
    meal_key: mealKey(meal),
  });
  if (pending) return { status: "pending", question_id: pending.id };
  const exact = selectMealFoodByKey(database, {
    user_id: userId,
    meal_key: mealKey(meal),
  });
  if (exact) return { status: "known", food_id: exact.id };
  const own = selectMealFoodCandidates(database, { user_id: userId }).map(
    (row): NutritionRecord => ({
      ...fromStoredNutrition({
        ...row,
        provenance: provenanceSchema.parse(row.provenance),
      }),
      source: "own",
      sourceId: String(row.id),
      name: row.name,
      brand: null,
      barcode: null,
      labelSource: row.source,
      retrievedAt: null,
      mealKit: {
        service: zod.string().parse(row.service),
        mealName: zod.string().parse(row.meal_name),
        chef: row.chef,
      },
    }),
  );
  const resolved = resolveLookup(
    {
      kind: "automatic",
      key: {
        kind: "meal_kit",
        service: meal.service,
        mealName: meal.name,
        chef: meal.chef,
      },
      basis: "any",
    },
    { own },
  );
  return resolved.status === "match"
    ? { status: "known", food_id: Number(resolved.records[0].sourceId) }
    : { status: "unknown" };
}

export function askMealNutrition(
  database: Database,
  userId: number,
  meal: Meal,
  now: string,
  kinds: ReadonlyMap<string, QuestionKind>,
) {
  if (mealNutritionState(database, userId, meal).status !== "unknown") return;
  createQuestion(
    database,
    {
      userId,
      kind: mealNutritionKind.name,
      subjectRef: mealKey(meal),
      prompt: `Enter label values for ${meal.name} (1 whole meal).`,
    },
    { now: () => new Date(now) },
    kinds,
  );
}
