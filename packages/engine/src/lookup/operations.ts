import { z } from "zod";
import { defineOperation, OperationError } from "../operations/registry.ts";
import {
  addSourceFood,
  CandidateError,
  lookupBarcode,
  searchFoodCandidates,
  searchOnline,
} from "./index.ts";

const amount = z.number().nonnegative().nullable();
const sourceStatus = z.enum([
  "ok",
  "skipped",
  "unavailable",
  "rate_limited",
  "not_called",
]);
const sourceFood = z.strictObject({
  source_food_id: z.int().positive(),
  source: z.enum(["usda", "off"]),
  source_key: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  barcode: z.string().nullable(),
  serving_size: z.number().positive().nullable(),
  serving_unit: z.string().nullable(),
  kcal: amount,
  protein_g: amount,
  carbs_g: amount,
  fat_g: amount,
  fiber_g: amount,
  provenance: z.enum(["verified", "label"]),
  fetched_at: z.iso.datetime(),
});
const output = z.strictObject({
  result: z.enum(["match", "ambiguous", "no_match"]),
  foods: z.array(sourceFood),
  sources: z.strictObject({ usda: sourceStatus, off: sourceStatus }),
});
const shared = {
  method: "POST" as const,
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser_and_agent" as const,
  admin: false,
  bodyLimit: 8192,
  output,
};

const candidateStatus = {
  lookup_unavailable: 503,
  lookup_rate_limited: 503,
  lookup_failed: 503,
  lookup_invalid_response: 503,
  food_not_found: 404,
  no_mass_basis: 400,
  unsupported_food: 400,
} as const;

async function candidateCall<Result>(call: () => Promise<Result>) {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof CandidateError)) throw error;
    throw new OperationError(candidateStatus[error.code], error.code);
  }
}

export const lookupOperations = [
  defineOperation({
    ...shared,
    name: "lookup_barcode",
    path: "/api/lookup/barcode",
    input: z.strictObject({ barcode: z.string().regex(/^\d{8,14}$/) }),
    handler: async (input, context) => {
      if (!context.lookup) throw new OperationError(503, "lookup_unavailable");
      return {
        status: 200,
        body: await lookupBarcode(
          context.database,
          context.lookup,
          input.barcode,
        ),
      };
    },
  }),
  defineOperation({
    ...shared,
    name: "search_online",
    path: "/api/lookup/search",
    input: z.strictObject({
      name: z.string().trim().min(1).max(200),
      brand: z.string().trim().min(1).max(200).optional(),
    }),
    handler: async (input, context) => {
      if (!context.lookup) throw new OperationError(503, "lookup_unavailable");
      return {
        status: 200,
        body: await searchOnline(
          context.database,
          context.lookup,
          input.name,
          input.brand,
        ),
      };
    },
  }),
  defineOperation({
    ...shared,
    name: "search_food_candidates",
    description:
      "Search USDA for foods by name and list up to 10 with a mass basis, generic foods first. Saves nothing; pass a chosen fdc_id to add_source_food.",
    path: "/api/lookup/candidates",
    input: z.strictObject({
      query: z.string().trim().min(1).max(200),
      limit: z.int().min(1).max(10).default(10),
    }),
    output: z.strictObject({
      candidates: z.array(
        z.strictObject({
          fdc_id: z.int().positive(),
          name: z.string(),
          data_type: z.enum(["Foundation", "SR Legacy", "Branded"]),
          brand: z.string().nullable(),
          kcal_per_100g: amount,
        }),
      ),
    }),
    handler: async (input, context) => {
      const lookup = context.lookup;
      if (!lookup) throw new OperationError(503, "lookup_unavailable");
      return {
        status: 200,
        body: {
          candidates: await candidateCall(() =>
            searchFoodCandidates(lookup, input.query, input.limit),
          ),
        },
      };
    },
  }),
  defineOperation({
    ...shared,
    name: "add_source_food",
    description:
      "Save one USDA food by its fdc_id, per 100 g, and return its source_food_id for log_food. Repeating it returns the same food.",
    path: "/api/lookup/source-food",
    input: z.strictObject({ fdc_id: z.int().positive() }),
    output: sourceFood,
    handler: async (input, context) => {
      const lookup = context.lookup;
      if (!lookup) throw new OperationError(503, "lookup_unavailable");
      return {
        status: 200,
        body: await candidateCall(() =>
          addSourceFood(context.database, lookup, input.fdc_id),
        ),
      };
    },
  }),
];
