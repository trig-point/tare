import {
  checkRecord,
  type NutrientValue,
  type NutritionRecord,
  sameName,
} from "@tare/nutrition";
import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import { z } from "zod";
import { validateOffUserAgent } from "../config.ts";

export type OffResult =
  | { status: "ok"; records: readonly NutritionRecord[]; rejected: number }
  | { status: "unconfigured" | "invalid_input" }
  | { status: "rate_limited"; retryAfterMs: number }
  | {
      status: "unavailable";
      reason: "network" | "http" | "invalid_response";
      httpStatus?: number;
    };

const fields = "code,product_name,brands,nutrition_data_per,nutriments";
const origin = "https://world.openfoodfacts.org";

// The slice of Open Food Facts responses the adapter reads; other fields are ignored.
const nutrientAmount = z.number().optional();
const productSchema = z.object({
  code: z.string(),
  product_name: z.string().nullish(),
  brands: z.string().nullish(),
  nutrition_data_per: z.string().nullish(),
  nutriments: z
    .object({
      "energy-kcal_100g": nutrientAmount,
      proteins_100g: nutrientAmount,
      carbohydrates_100g: nutrientAmount,
      fat_100g: nutrientAmount,
      fiber_100g: nutrientAmount,
    })
    .nullish(),
});
const productResponseSchema = z.union([
  z.object({ status: z.literal(0) }),
  z.object({ status: z.literal(1), product: productSchema }),
]);
// Products are checked one by one, so a single malformed product cannot fail a search.
const searchResponseSchema = z.object({ products: z.array(z.unknown()) });

export type OffProduct = z.input<typeof productSchema>;
export type OffProductResponse = z.input<typeof productResponseSchema>;
export type OffSearchResponse = z.input<typeof searchResponseSchema>;

export function normalizeBarcode(code: string): string {
  if (!/^\d{8,14}$/.test(code)) throw new Error("Invalid barcode");
  return code.length === 12 ? `0${code}` : code;
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function recordFrom(
  product: z.output<typeof productSchema>,
  retrievedAt: string,
): NutritionRecord | null {
  const code = product.code.trim();
  if (!/^\d{8,14}$/.test(code)) return null;
  const basis =
    product.nutrition_data_per === "100g"
      ? ({ dimension: "mass", amount: 100, unit: "g" } as const)
      : product.nutrition_data_per === "100ml"
        ? ({ dimension: "volume", amount: 100, unit: "ml" } as const)
        : null;
  if (!basis) return null;
  const nutrient = (amount: number | undefined): NutrientValue =>
    amount === undefined ? null : { amount, provenance: "label" };
  const nutriments = product.nutriments ?? {};
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
      kcal: nutrient(nutriments["energy-kcal_100g"]),
      protein_g: nutrient(nutriments.proteins_100g),
      carbs_g: nutrient(nutriments.carbohydrates_100g),
      fat_g: nutrient(nutriments.fat_100g),
      fiber_g: nutrient(nutriments.fiber_100g),
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
  // Fixed windows start at the first request, so a burst across a reset can
  // reach twice the limit in a rolling minute; the 429 backoff absorbs that.
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
      return { status: "ok", records: [], rejected: 0 };
    if (!response.ok)
      return {
        status: "unavailable",
        reason: "http",
        httpStatus: response.status,
      };
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "unavailable", reason: "invalid_response" };
    }
    let products: ReturnType<typeof productSchema.safeParse>[];
    if (kind === "product") {
      const parsed = productResponseSchema.safeParse(body);
      if (!parsed.success)
        return { status: "unavailable", reason: "invalid_response" };
      products =
        parsed.data.status === 1
          ? [{ success: true, data: parsed.data.product }]
          : [];
    } else {
      const parsed = searchResponseSchema.safeParse(body);
      if (!parsed.success)
        return { status: "unavailable", reason: "invalid_response" };
      products = parsed.data.products.map((product) =>
        productSchema.safeParse(product),
      );
    }
    const retrievedAt = new Date().toISOString();
    const records = products.flatMap((product) => {
      const record = product.success
        ? recordFrom(product.data, retrievedAt)
        : null;
      return record ? [record] : [];
    });
    return {
      status: "ok",
      records,
      rejected: products.length - records.length,
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
            ...result,
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
            ...result,
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
