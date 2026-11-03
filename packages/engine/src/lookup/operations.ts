import { z } from "zod";
import { defineOperation, OperationError } from "../operations/registry.ts";
import { lookupBarcode, searchOnline } from "./index.ts";

const amount = z.number().nonnegative().nullable();
const sourceStatus = z.enum([
  "ok",
  "skipped",
  "unavailable",
  "rate_limited",
  "not_called",
]);
const output = z.strictObject({
  result: z.enum(["match", "ambiguous", "no_match"]),
  foods: z.array(
    z.strictObject({
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
    }),
  ),
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
];
