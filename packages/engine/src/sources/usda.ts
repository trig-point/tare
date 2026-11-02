import {
  checkRecord,
  type NutrientValue,
  type NutritionRecord,
  type Provenance,
  type ServingBasis,
} from "@tare/nutrition";
import type { Config } from "../config.ts";

const DATA_TYPES = ["Foundation", "SR Legacy", "Branded"] as const;
const API_URL = "https://api.nal.usda.gov/fdc/v1/";

export type UsdaResult =
  | { status: "ok"; records: NutritionRecord[]; rejected: number }
  | { status: "skipped"; reason: "missing_key" }
  | {
      status: "error";
      reason: "http" | "network" | "invalid_response" | "invalid_request";
      statusCode?: number;
    };

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function basisFor(food: Record<string, unknown>): ServingBasis | null {
  if (food.dataType !== "Branded")
    return { dimension: "mass", amount: 100, unit: "g" };
  const unit = text(food.servingSizeUnit)?.toLowerCase();
  if (unit === "g" || unit === "grm")
    return { dimension: "mass", amount: 100, unit: "g" };
  if (unit === "ml" || unit === "mlt")
    return { dimension: "volume", amount: 100, unit: "ml" };
  return null;
}

function recordFor(
  value: unknown,
  retrievedAt: string,
): NutritionRecord | null {
  const food = object(value);
  if (
    !food ||
    !DATA_TYPES.some((dataType) => dataType === food.dataType) ||
    typeof food.fdcId !== "number" ||
    !Number.isSafeInteger(food.fdcId) ||
    food.fdcId <= 0 ||
    !Array.isArray(food.foodNutrients)
  )
    return null;
  const name = text(food.description);
  const basis = basisFor(food);
  if (!name || !basis) return null;
  const provenance: Provenance =
    food.dataType === "Branded" ? "label" : "verified";
  const nutrients = new Map<number, { amount: number; unit: string }>();
  for (const value of food.foodNutrients) {
    const entry = object(value);
    if (!entry) continue;
    const nutrient = object(entry.nutrient);
    const nutrientId = nutrient ? nutrient.id : entry.nutrientId;
    const amount = nutrient ? entry.amount : entry.value;
    const unit = text(nutrient ? nutrient.unitName : entry.unitName);
    if (
      typeof nutrientId === "number" &&
      typeof amount === "number" &&
      unit !== null
    )
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
  const record: NutritionRecord = {
    source: "usda",
    sourceId: String(food.fdcId),
    name,
    brand: text(food.brandName) ?? text(food.brandOwner),
    barcode: text(food.gtinUpc),
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
      response = await request(url, { headers: { "X-Api-Key": apiKey } });
    } catch {
      return { status: "error", reason: "network" };
    }
    if (!response.ok)
      return { status: "error", reason: "http", statusCode: response.status };
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "error", reason: "invalid_response" };
    }
    const payload = object(body);
    if (!payload || (query !== undefined && !Array.isArray(payload.foods)))
      return { status: "error", reason: "invalid_response" };
    const foods: unknown[] =
      query !== undefined ? (payload.foods as unknown[]) : [payload];
    const records: NutritionRecord[] = [];
    const retrievedAt = now().toISOString();
    for (const food of foods) {
      const record = recordFor(food, retrievedAt);
      if (record && (query !== undefined || path === `food/${record.sourceId}`))
        records.push(record);
    }
    return { status: "ok", records, rejected: foods.length - records.length };
  }

  return {
    async search(query: string): Promise<UsdaResult> {
      if (apiKey && !query.trim())
        return { status: "error", reason: "invalid_request" };
      return lookup("foods/search", query.trim());
    },
    async fetchById(fdcId: string): Promise<UsdaResult> {
      if (
        apiKey &&
        (!/^[1-9]\d*$/.test(fdcId) || !Number.isSafeInteger(Number(fdcId)))
      )
        return { status: "error", reason: "invalid_request" };
      return lookup(`food/${fdcId}`);
    },
  };
}
