import {
  checkRecord,
  type NutrientValue,
  type NutritionRecord,
  type Provenance,
  type ServingBasis,
} from "@tare/nutrition";
import { z } from "zod";
import type { Config } from "../config.ts";

const DATA_TYPES = ["Foundation", "SR Legacy", "Branded"] as const;
const API_URL = "https://api.nal.usda.gov/fdc/v1/";
// Bounds an explicit lookup so a stalled USDA call falls through to Open Food Facts.
const REQUEST_TIMEOUT_MS = 10_000;

const optionalText = z.string().nullish();

/** Only the slice of a USDA food the adapter reads; other fields are ignored. */
const usdaFoodSchema = z.object({
  dataType: z.string(),
  fdcId: z.int().positive(),
  description: z.string(),
  brandName: optionalText,
  brandOwner: optionalText,
  gtinUpc: optionalText,
  servingSizeUnit: optionalText,
  foodNutrients: z.array(
    z.union([
      z.object({
        nutrient: z.object({ id: z.number(), unitName: z.string() }),
        amount: z.number().optional(),
      }),
      z.object({
        nutrientId: z.number(),
        unitName: z.string(),
        value: z.number().optional(),
      }),
    ]),
  ),
});

const usdaSearchSchema = z.object({ foods: z.array(z.unknown()) });

export type UsdaFood = z.input<typeof usdaFoodSchema>;

export type UsdaResult =
  | { status: "ok"; records: NutritionRecord[]; rejected: number }
  | { status: "skipped"; reason: "missing_key" }
  | {
      status: "error";
      reason: "http" | "network" | "invalid_response" | "invalid_request";
      statusCode?: number;
    };

function basisFor(food: z.output<typeof usdaFoodSchema>): ServingBasis | null {
  if (food.dataType !== "Branded")
    return { dimension: "mass", amount: 100, unit: "g" };
  const unit = food.servingSizeUnit?.trim().toLowerCase();
  if (unit === "g" || unit === "grm")
    return { dimension: "mass", amount: 100, unit: "g" };
  if (unit === "ml" || unit === "mlt")
    return { dimension: "volume", amount: 100, unit: "ml" };
  return null;
}

function presentText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function recordFor(
  food: z.output<typeof usdaFoodSchema>,
  retrievedAt: string,
): NutritionRecord | null {
  const name = presentText(food.description);
  const basis = basisFor(food);
  if (!DATA_TYPES.some((dataType) => dataType === food.dataType)) return null;
  if (!name || !basis) return null;
  const provenance: Provenance =
    food.dataType === "Branded" ? "label" : "verified";
  const nutrients = new Map<number, { amount: number; unit: string }>();
  for (const entry of food.foodNutrients) {
    const [nutrientId, amount] =
      "nutrient" in entry
        ? [entry.nutrient.id, entry.amount]
        : [entry.nutrientId, entry.value];
    const unit = "nutrient" in entry ? entry.nutrient.unitName : entry.unitName;
    if (amount !== undefined)
      nutrients.set(nutrientId, { amount, unit: unit.toLowerCase() });
  }
  function nutrientValue(identifiers: number[], energy = false): NutrientValue {
    for (const identifier of identifiers) {
      const nutrient = nutrients.get(identifier);
      if (!nutrient) continue;
      if (nutrient.unit === (energy ? "kcal" : "g"))
        return { amount: nutrient.amount, provenance };
      if (energy && nutrient.unit === "kj")
        return { amount: nutrient.amount / 4.184, provenance };
    }
    return null;
  }
  const barcode = presentText(food.gtinUpc);
  const record: NutritionRecord = {
    source: "usda",
    sourceId: String(food.fdcId),
    name,
    brand: presentText(food.brandName) ?? presentText(food.brandOwner),
    // A malformed vendor barcode costs only the barcode, not the food.
    barcode: barcode && /^\d{8,14}$/.test(barcode) ? barcode : null,
    labelSource: null,
    retrievedAt,
    mealKit: null,
    basis,
    nutrients: {
      kcal: nutrientValue([1008, 2048, 2047, 1062], true),
      protein_g: nutrientValue([1003]),
      carbs_g: nutrientValue([1005]),
      fat_g: nutrientValue([1004]),
      fiber_g: nutrientValue([1079]),
    },
  };
  return checkRecord(record).length === 0 ? record : null;
}

export function createUsdaAdapter(
  config: Pick<Config, "usdaApiKey">,
  options: { fetch?: typeof fetch; now?: () => Date } = {},
) {
  const apiKey = config.usdaApiKey?.trim();
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());

  async function lookup(path: string, query?: string): Promise<UsdaResult> {
    if (!apiKey) return { status: "skipped", reason: "missing_key" };
    const url = new URL(path, API_URL);
    if (query !== undefined) {
      url.search = new URLSearchParams({
        query,
        dataType: DATA_TYPES.join(","),
        pageSize: "25",
      }).toString();
    }
    let response: Response;
    try {
      response = await request(url, {
        headers: { "X-Api-Key": apiKey },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { status: "error", reason: "network" };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { status: "error", reason: "http", statusCode: response.status };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "error", reason: "invalid_response" };
    }
    let foods: ReturnType<typeof usdaFoodSchema.safeParse>[];
    if (query !== undefined) {
      const search = usdaSearchSchema.safeParse(body);
      if (!search.success)
        return { status: "error", reason: "invalid_response" };
      foods = search.data.foods.map((food) => usdaFoodSchema.safeParse(food));
    } else {
      const detail = usdaFoodSchema.safeParse(body);
      if (!detail.success)
        return { status: "error", reason: "invalid_response" };
      foods = [detail];
    }
    const records: NutritionRecord[] = [];
    const retrievedAt = now().toISOString();
    for (const food of foods) {
      const record = food.success ? recordFor(food.data, retrievedAt) : null;
      if (record && (query !== undefined || path === `food/${record.sourceId}`))
        records.push(record);
    }
    return { status: "ok", records, rejected: foods.length - records.length };
  }

  return {
    async search(query: string): Promise<UsdaResult> {
      if (!query.trim()) return { status: "error", reason: "invalid_request" };
      return lookup("foods/search", query.trim());
    },
    async fetchById(fdcId: string): Promise<UsdaResult> {
      if (!/^[1-9]\d*$/.test(fdcId) || !Number.isSafeInteger(Number(fdcId)))
        return { status: "error", reason: "invalid_request" };
      return lookup(`food/${fdcId}`);
    },
  };
}
