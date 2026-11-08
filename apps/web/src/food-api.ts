import { z } from "zod";
import { api, type Session } from "./api.ts";
import type { OutboxReplay } from "./outbox-replay.ts";

const catalogNutrient = z
  .object({ amount: z.number().nonnegative() })
  .nullable()
  .transform((value) => value?.amount ?? null);
const catalogSchema = z.object({
  result: z.enum(["match", "ambiguous", "no_match"]),
  foods: z.array(
    z.object({
      reference: z.object({
        kind: z.enum(["food", "source_food"]),
        id: z.number().int().positive(),
      }),
      name: z.string(),
      brand: z.string().nullable(),
      serving: z.object({ amount: z.number().positive(), unit: z.string() }),
      nutrients: z.object({
        kcal: catalogNutrient,
        protein_g: catalogNutrient,
      }),
    }),
  ),
});
const onlineAmount = z.number().nonnegative().nullable();
const onlineSchema = z.object({
  result: z.enum(["match", "ambiguous", "no_match"]),
  foods: z.array(
    z.object({
      source_food_id: z.number().int().positive(),
      name: z.string(),
      brand: z.string().nullable(),
      serving_size: z.number().positive().nullable(),
      serving_unit: z.string().nullable(),
      kcal: onlineAmount,
      protein_g: onlineAmount,
    }),
  ),
});

export type FoodChoice = {
  reference: { kind: "food" | "source_food"; id: number };
  name: string;
  brand: string | null;
  serving: string | null;
  kcal: number | null;
  protein_g: number | null;
};
export type CatalogResult = {
  result: "match" | "ambiguous" | "no_match";
  foods: FoodChoice[];
};

export function catalogQuery(person: number, name: string) {
  const term = name.trim();
  return {
    queryKey: ["find_food", person, term] as const,
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      findFood(term, signal),
  };
}

export async function findFood(
  name: string,
  signal?: AbortSignal,
): Promise<CatalogResult> {
  const response = catalogSchema.parse(
    await api("/api/foods/find", {
      method: "POST",
      body: JSON.stringify({ name }),
      signal,
    }),
  );
  return {
    result: response.result,
    foods: response.foods.map((food) => ({
      reference: food.reference,
      name: food.name,
      brand: food.brand,
      serving: `${food.serving.amount} ${food.serving.unit}`,
      kcal: food.nutrients.kcal,
      protein_g: food.nutrients.protein_g,
    })),
  };
}

// Ambiguous results are never offered: the person picks only exact matches.
export async function searchOnline(name: string): Promise<FoodChoice[]> {
  const response = onlineSchema.parse(
    await api("/api/lookup/search", {
      method: "POST",
      body: JSON.stringify({ name: name.trim() }),
    }),
  );
  if (response.result !== "match") return [];
  return response.foods.map((food) => ({
    reference: { kind: "source_food", id: food.source_food_id },
    name: food.name,
    brand: food.brand,
    serving:
      food.serving_size === null
        ? null
        : `${food.serving_size} ${food.serving_unit ?? ""}`.trim(),
    kcal: food.kcal,
    protein_g: food.protein_g,
  }));
}

export async function enqueueFood(
  replay: OutboxReplay,
  person: Session["user"],
  food: FoodChoice,
  servings: string,
) {
  const value = Number(servings);
  if (!servings.trim() || !Number.isFinite(value) || value <= 0)
    throw new Error("Invalid servings");
  await replay.enqueue(
    "intake",
    {
      [food.reference.kind === "food" ? "food_id" : "source_food_id"]:
        food.reference.id,
      servings: value,
    },
    person,
  );
}

export async function enqueueNumbers(
  replay: OutboxReplay,
  person: Session["user"],
  name: string,
  values: Record<string, string>,
) {
  const numbers: Record<string, number> = {};
  for (const [key, text] of Object.entries(values)) {
    if (!text.trim()) continue;
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0) throw new Error("Invalid number");
    numbers[key] = value;
  }
  if (!name.trim() || Object.keys(numbers).length === 0)
    throw new Error("Invalid entry");
  await replay.enqueue(
    "intake",
    { name: name.trim(), ...numbers, provenance: "estimated" },
    person,
  );
}
