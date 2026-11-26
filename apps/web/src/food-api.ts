import { z } from "zod";
import { api, type Session } from "./api.ts";
import { eatingOutOverride, foodChoiceFields } from "./eating-out-fields.ts";
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
      ...foodChoiceFields,
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
      ...foodChoiceFields,
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
  servings?: number;
  eating_out_default?: boolean | undefined;
  can_tag_eating_out?: boolean | undefined;
};
export type CatalogResult = {
  result: "match" | "ambiguous" | "no_match";
  foods: FoodChoice[];
};

export function mergeChoices(...lists: FoodChoice[][]) {
  const seen = new Set<string>();
  return lists.flat().filter((food) => {
    const key = `${food.reference.kind}-${food.reference.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const usualSchema = z.object({
  foods: z.array(
    z.object({
      reference: z.object({
        kind: z.enum(["food", "source_food"]),
        id: z.number().int().positive(),
      }),
      name: z.string(),
      brand: z.string().nullable(),
      ...foodChoiceFields,
      usual_servings: z.number().positive(),
      serving: z.object({ amount: z.number(), unit: z.string() }).nullable(),
      kcal: z.number().nonnegative().nullable(),
      protein_g: z.number().nonnegative().nullable(),
    }),
  ),
});
const savedUsualSchema = z.array(
  z.object({
    reference: z.object({
      kind: z.enum(["food", "source_food"]),
      id: z.number().int().positive(),
    }),
    name: z.string(),
    brand: z.string().nullable(),
    serving: z.string().nullable(),
    kcal: z.number().nullable(),
    protein_g: z.number().nullable(),
    ...foodChoiceFields,
    servings: z.number().positive().optional(),
  }),
);
const usualStorageKey = (person: number) => `tare:usual-foods:${person}`;

/** Most-logged foods; each successful load is kept on the device for offline use. */
export function usualFoodsQuery(person: number) {
  return {
    queryKey: ["list_usual_foods", person] as const,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const foods = usualSchema
        .parse(await api("/api/foods/usual", { signal }))
        .foods.map(
          (food): FoodChoice => ({
            reference: food.reference,
            name: food.name,
            brand: food.brand,
            serving:
              food.serving === null
                ? null
                : `${food.serving.amount} ${food.serving.unit}`.trim(),
            kcal: food.kcal,
            protein_g: food.protein_g,
            servings: food.usual_servings,
            ...choiceTags(food),
          }),
        );
      try {
        localStorage.setItem(usualStorageKey(person), JSON.stringify(foods));
      } catch {
        // Blocked storage only loses the offline copy.
      }
      return foods;
    },
  };
}

/** The last loaded list, or null when none was kept or storage is unavailable. */
export function savedUsualFoods(person: number): FoodChoice[] | null {
  try {
    const saved = localStorage.getItem(usualStorageKey(person));
    if (saved === null) return null;
    const parsed = savedUsualSchema.safeParse(JSON.parse(saved));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Foods whose name contains the term, keeping their order. */
export function matchingFoods(foods: FoodChoice[], term: string) {
  const needle = term.trim().toLocaleLowerCase();
  if (needle === "") return [];
  return foods.filter((food) => food.name.toLocaleLowerCase().includes(needle));
}

export function catalogQuery(person: number, name: string) {
  const term = name.trim();
  return {
    queryKey: ["find_food", person, term] as const,
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      findFood(term, signal),
  };
}

const foodMatchesSchema = z.object({
  foods: z.array(
    z.object({
      reference: z.object({
        kind: z.enum(["food", "source_food"]),
        id: z.number().int().positive(),
      }),
      source: z.enum(["usda", "off"]).nullable(),
      name: z.string(),
      brand: z.string().nullable(),
      serving: z.string().nullable(),
    }),
  ),
});
export type FoodMatch = z.infer<typeof foodMatchesSchema>["foods"][number];

export function foodMatchesQuery(person: number, name: string) {
  const term = name.trim();
  return {
    queryKey: ["search_foods", person, term] as const,
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      foodMatchesSchema.parse(
        await api("/api/foods/search", {
          method: "POST",
          body: JSON.stringify({ name: term }),
          signal,
        }),
      ).foods,
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
      ...choiceTags(food),
    })),
  };
}

// Ambiguous results are never offered: the person picks only exact matches.
export async function searchOnline(name: string): Promise<FoodChoice[]> {
  return onlineChoices(
    await api("/api/lookup/search", {
      method: "POST",
      body: JSON.stringify({ name: name.trim() }),
    }),
  );
}

export async function lookupBarcode(barcode: string): Promise<FoodChoice[]> {
  return onlineChoices(
    await api("/api/lookup/barcode", {
      method: "POST",
      body: JSON.stringify({ barcode }),
    }),
  );
}

function onlineChoices(body: unknown): FoodChoice[] {
  const response = onlineSchema.parse(body);
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
    ...choiceTags(food),
  }));
}

export function choiceTags(
  food: Pick<FoodChoice, "eating_out_default" | "can_tag_eating_out">,
) {
  const { eating_out_default, can_tag_eating_out } = food;
  return {
    ...(eating_out_default === undefined ? {} : { eating_out_default }),
    ...(can_tag_eating_out === undefined ? {} : { can_tag_eating_out }),
  };
}

export async function enqueueFood(
  replay: OutboxReplay,
  person: Session["user"],
  food: FoodChoice,
  servings: string,
  checked?: boolean,
) {
  const value = Number(servings);
  if (!servings.trim() || !Number.isFinite(value) || value <= 0)
    throw new Error("Invalid servings");
  const eating_out = eatingOutOverride(food, checked);
  await replay.enqueue(
    "intake",
    {
      [food.reference.kind === "food" ? "food_id" : "source_food_id"]:
        food.reference.id,
      servings: value,
      ...(eating_out === undefined ? {} : { eating_out }),
    },
    person,
  );
}

export async function enqueueNumbers(
  replay: OutboxReplay,
  person: Session["user"],
  name: string,
  values: Record<string, string>,
  required: readonly string[] = [],
  eatingOut = false,
  postedMenu = false,
) {
  if (required.some((key) => !values[key]?.trim()))
    throw new Error("Missing required number");
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
    {
      name: name.trim(),
      ...numbers,
      provenance: "estimated",
      ...(eatingOut ? { eating_out: true } : {}),
      ...(postedMenu && numbers.kcal !== undefined
        ? { kcal_basis: "menu" }
        : {}),
    },
    person,
  );
}
