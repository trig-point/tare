import {
  checkRecord,
  type NutrientValue,
  type NutritionRecord,
  sameName,
} from "@tare/nutrition";
import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import { validateOffUserAgent } from "../config.ts";

export type OffResult =
  | { status: "ok"; records: readonly NutritionRecord[] }
  | { status: "unconfigured" | "invalid_input" }
  | { status: "rate_limited"; retryAfterMs: number }
  | {
      status: "unavailable";
      reason: "network" | "http" | "invalid_response";
      httpStatus?: number;
    };

const fields = "code,product_name,brands,nutrition_data_per,nutriments";
const origin = "https://world.openfoodfacts.org";

export function normalizeBarcode(code: string): string {
  if (!/^\d{8,14}$/.test(code)) throw new Error("Invalid barcode");
  return code.length === 12 ? `0${code}` : code;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function recordFrom(
  value: unknown,
  retrievedAt: string,
): NutritionRecord | null {
  const product = object(value);
  if (!product) return null;
  const code = text(product.code);
  if (!code || !/^\d{8,14}$/.test(code)) return null;
  const basis =
    product.nutrition_data_per === "100g"
      ? ({ dimension: "mass", amount: 100, unit: "g" } as const)
      : product.nutrition_data_per === "100ml"
        ? ({ dimension: "volume", amount: 100, unit: "ml" } as const)
        : null;
  if (!basis) return null;
  const nutrients = object(product.nutriments);
  const nutrient = (key: string): NutrientValue => {
    const amount = nutrients?.[`${key}_100g`];
    return typeof amount === "number" ? { amount, provenance: "label" } : null;
  };
  const barcode = normalizeBarcode(code);
  const record: NutritionRecord = {
    source: "off",
    sourceId: barcode,
    name: text(product.product_name) ?? "",
    brand: text(product.brands),
    barcode,
    labelSource: `${origin}/product/${barcode}`,
    retrievedAt,
    mealKit: null,
    basis,
    nutrients: {
      kcal: nutrient("energy-kcal"),
      protein_g: nutrient("proteins"),
      carbs_g: nutrient("carbohydrates"),
      fat_g: nutrient("fat"),
      fiber_g: nutrient("fiber"),
    },
  };
  return checkRecord(record).length === 0 ? record : null;
}

export function createOffAdapter(options: {
  userAgent?: string;
  fetch?: typeof fetch;
}) {
  const userAgent = validateOffUserAgent(options.userAgent);
  const fetchResponse = options.fetch ?? fetch;
  const limiters = {
    product: new RateLimiterMemory({ points: 100, duration: 60 }),
    search: new RateLimiterMemory({ points: 10, duration: 60 }),
  };

  async function request(
    kind: "product" | "search",
    url: URL,
  ): Promise<OffResult> {
    if (!userAgent) return { status: "unconfigured" };
    const limiter = limiters[kind];
    try {
      await limiter.consume("off");
    } catch (error) {
      if (!(error instanceof RateLimiterRes)) throw error;
      return { status: "rate_limited", retryAfterMs: error.msBeforeNext };
    }
    let response: Response;
    try {
      response = await fetchResponse(url, {
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return { status: "unavailable", reason: "network" };
    }
    if (response.status === 429) {
      const retry = response.headers.get("Retry-After");
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : null;
      const date = retry === null ? Number.NaN : Date.parse(retry);
      const retryAfterMs = Math.max(
        60_000,
        seconds === null
          ? Number.isFinite(date)
            ? date - Date.now()
            : 0
          : seconds * 1000,
      );
      await limiter.block("off", retryAfterMs / 1000);
      return { status: "rate_limited", retryAfterMs };
    }
    if (kind === "product" && response.status === 404)
      return { status: "ok", records: [] };
    if (!response.ok)
      return {
        status: "unavailable",
        reason: "http",
        httpStatus: response.status,
      };
    let payload: Record<string, unknown> | null;
    try {
      payload = object(await response.json());
    } catch {
      return { status: "unavailable", reason: "invalid_response" };
    }
    if (!payload) return { status: "unavailable", reason: "invalid_response" };
    if (kind === "product" && payload.status === 0)
      return { status: "ok", records: [] };
    const products = kind === "product" ? [payload.product] : payload.products;
    if (
      !Array.isArray(products) ||
      (kind === "product" && !object(payload.product))
    )
      return { status: "unavailable", reason: "invalid_response" };
    const retrievedAt = new Date().toISOString();
    return {
      status: "ok",
      records: products.flatMap((product) => {
        const record = recordFrom(product, retrievedAt);
        return record ? [record] : [];
      }),
    };
  }

  return {
    async lookupBarcode(code: string): Promise<OffResult> {
      if (!userAgent) return { status: "unconfigured" };
      if (!/^\d{8,14}$/.test(code)) return { status: "invalid_input" };
      const barcode = normalizeBarcode(code);
      const url = new URL(`/api/v2/product/${barcode}.json`, origin);
      url.searchParams.set("fields", fields);
      const result = await request("product", url);
      return result.status === "ok"
        ? {
            status: "ok",
            records: result.records.filter(
              (record) => record.barcode === barcode,
            ),
          }
        : result;
    },
    async searchName(name: string, brand?: string | null): Promise<OffResult> {
      if (!userAgent) return { status: "unconfigured" };
      if (!name.trim()) return { status: "invalid_input" };
      const url = new URL("/cgi/search.pl", origin);
      for (const [key, value] of Object.entries({
        action: "process",
        search_simple: "1",
        search_terms: name,
        json: "1",
        page_size: "20",
        fields,
      }))
        url.searchParams.set(key, value);
      const result = await request("search", url);
      return result.status === "ok"
        ? {
            status: "ok",
            records: result.records.filter(
              (record) =>
                sameName(name, record.name) &&
                (brand == null ||
                  (record.brand !== null && sameName(brand, record.brand))),
            ),
          }
        : result;
    },
  };
}
