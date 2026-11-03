import {
  fromStoredNutrition,
  type IdentityKey,
  matchesIdentity,
  type NutritionRecord,
  resolveLookup,
  toStoredNutrition,
} from "@tare/nutrition";
import type { Database } from "better-sqlite3";
import { scopeDatabase, writeTransaction } from "../db.ts";
import type { SelectSourceFoodResult } from "../queries/select-source-food.ts";
import { selectSourceFoodsByBarcode } from "../queries/select-source-foods-by-barcode.ts";
import { upsertSourceFood } from "../queries/upsert-source-food.ts";
import { type createOffAdapter, normalizeBarcode } from "../sources/off.ts";
import type { createUsdaAdapter } from "../sources/usda.ts";

export interface LookupAdapters {
  usda: ReturnType<typeof createUsdaAdapter>;
  off: ReturnType<typeof createOffAdapter>;
}

type SourceStatus =
  | "ok"
  | "skipped"
  | "unavailable"
  | "rate_limited"
  | "not_called";
type SourceRow = SelectSourceFoodResult;
type LookupFood = Omit<SourceRow, "id"> & { source_food_id: number };
export interface OnlineLookupResult {
  result: "match" | "ambiguous" | "no_match";
  foods: LookupFood[];
  sources: { usda: SourceStatus; off: SourceStatus };
}

function normalizedRecord(record: NutritionRecord): NutritionRecord {
  return {
    ...record,
    barcode: record.barcode === null ? null : normalizeBarcode(record.barcode),
  };
}

function cachedRecord(row: SourceRow): NutritionRecord {
  return normalizedRecord({
    ...fromStoredNutrition(row),
    source: row.source,
    sourceId: row.source_key,
    name: row.name,
    brand: row.brand,
    barcode: row.barcode,
    labelSource: null,
    retrievedAt: row.fetched_at,
    mealKit: null,
  });
}

function publicFood({ id, ...row }: SourceRow): LookupFood {
  return { ...row, source_food_id: id };
}

function storeRecord(database: Database, record: NutritionRecord): SourceRow {
  const stored = toStoredNutrition(record, "source_food");
  if (
    !stored.ok ||
    stored.row.provenance === "estimated" ||
    record.source === "own" ||
    record.retrievedAt === null
  )
    throw new Error("Invalid source nutrition");
  const row = upsertSourceFood(database, {
    ...stored.row,
    provenance: stored.row.provenance,
    source: record.source,
    source_key: record.sourceId,
    name: record.name,
    brand: record.brand,
    barcode: record.barcode,
    fetched_at: record.retrievedAt,
  });
  if (row === null) throw new Error("Source food was not stored");
  return row;
}

async function lookup(
  database: Database,
  adapters: LookupAdapters,
  key: Extract<IdentityKey, { kind: "barcode" | "name" }>,
): Promise<OnlineLookupResult> {
  const sources: OnlineLookupResult["sources"] = {
    usda: "not_called",
    off: "not_called",
  };
  const request = { kind: "explicit", key, basis: "any" } as const;
  const upc =
    key.kind === "barcode" && key.code.length === 13 && key.code.startsWith("0")
      ? key.code.slice(1)
      : null;
  const cached =
    key.kind === "barcode"
      ? selectSourceFoodsByBarcode(database, {
          barcode: key.code,
          upc: upc ?? key.code,
        })
      : [];
  const cachedRecords = cached.map(cachedRecord);
  const cacheResult = resolveLookup(request, { cache: cachedRecords });
  if (cacheResult.status === "match") {
    const selected = new Set(
      cacheResult.records.map(
        (record) => `${record.source}:${record.sourceId}`,
      ),
    );
    return {
      result: "match",
      foods: cached
        .filter((row) => selected.has(`${row.source}:${row.source_key}`))
        .map(publicFood),
      sources,
    };
  }
  if (cacheResult.final && cacheResult.reason !== "ambiguous")
    return { result: "no_match", foods: [], sources };
  if (cacheResult.final) {
    const candidates = cached.filter(
      (_row, index) => cachedRecords[index]?.basis != null,
    );
    const source = candidates.some((row) => row.source === "usda")
      ? "usda"
      : "off";
    return {
      result: "ambiguous",
      foods: candidates.filter((row) => row.source === source).map(publicFood),
      sources,
    };
  }

  for (const source of ["usda", "off"] as const) {
    const response =
      source === "usda"
        ? await adapters.usda.search(
            // FDC search matches only the exact stored GTIN token, and it
            // stores a UPC-A with or without the leading zero.
            key.kind === "barcode"
              ? [upc, key.code].filter(Boolean).join(" ")
              : [key.name, key.brand].filter(Boolean).join(" "),
          )
        : key.kind === "barcode"
          ? await adapters.off.lookupBarcode(key.code)
          : await adapters.off.searchName(key.name, key.brand);
    if (response.status !== "ok") {
      sources[source] =
        response.status === "skipped" || response.status === "unconfigured"
          ? "skipped"
          : response.status === "rate_limited" ||
              (response.status === "error" && response.statusCode === 429)
            ? "rate_limited"
            : "unavailable";
      continue;
    }
    sources[source] = "ok";
    const records = response.records.map(normalizedRecord);
    const resolved = resolveLookup(request, { [source]: records });
    const ambiguous =
      resolved.status === "miss" && resolved.reason === "ambiguous";
    if (resolved.status === "match" || ambiguous) {
      const kept =
        resolved.status === "match"
          ? resolved.records
          : records.filter(
              (record) => matchesIdentity(key, record) && record.basis !== null,
            );
      const rows = writeTransaction(database, (scope) =>
        kept.map((record) => storeRecord(scopeDatabase(scope), record)),
      );
      return {
        result: ambiguous ? "ambiguous" : "match",
        foods: rows.map(publicFood),
        sources,
      };
    }
  }
  return { result: "no_match", foods: [], sources };
}

export function lookupBarcode(
  database: Database,
  adapters: LookupAdapters,
  barcode: string,
) {
  return lookup(database, adapters, {
    kind: "barcode",
    code: normalizeBarcode(barcode),
  });
}

export function searchOnline(
  database: Database,
  adapters: LookupAdapters,
  name: string,
  brand?: string,
) {
  return lookup(database, adapters, {
    kind: "name",
    name,
    brand: brand ?? null,
  });
}
