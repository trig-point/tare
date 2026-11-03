import {
  fromStoredNutrition,
  type NutritionRecord,
  resolveLookup,
} from "@tare/nutrition";
import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import type { Reference } from "../logging/intake.ts";
import { selectCachedFoodCandidates } from "../queries/select-cached-food-candidates.ts";
import { selectOwnFoodCandidates } from "../queries/select-own-food-candidates.ts";

const provenanceSchema = zod.enum(["verified", "label", "estimated"]);
const nutrientSchema = zod
  .strictObject({ amount: zod.number(), provenance: provenanceSchema })
  .nullable();
export const findFoodInput = zod.strictObject({
  name: zod.string().trim().min(1),
  brand: zod.string().trim().min(1).optional(),
});
export const findFoodOutput = zod.strictObject({
  result: zod.enum(["match", "no_match", "ambiguous"]),
  foods: zod.array(
    zod.strictObject({
      reference: zod.strictObject({
        kind: zod.enum(["food", "source_food"]),
        id: zod.number().int().positive(),
      }),
      name: zod.string(),
      brand: zod.string().nullable(),
      serving: zod.strictObject({
        dimension: zod.enum(["mass", "volume", "count"]),
        amount: zod.number().positive(),
        unit: zod.string(),
      }),
      nutrients: zod.strictObject({
        kcal: nutrientSchema,
        protein_g: nutrientSchema,
        carbs_g: nutrientSchema,
        fat_g: nutrientSchema,
        fiber_g: nutrientSchema,
      }),
      provenance: provenanceSchema,
    }),
  ),
});

export function findFood(
  database: Database,
  personId: number,
  input: zod.infer<typeof findFoodInput>,
) {
  const references = new Map<
    NutritionRecord,
    { reference: Reference; provenance: zod.infer<typeof provenanceSchema> }
  >();
  const own = selectOwnFoodCandidates(database, { user_id: personId }).map(
    (row): NutritionRecord => {
      const provenance = provenanceSchema.parse(row.provenance);
      const record: NutritionRecord = {
        ...fromStoredNutrition({ ...row, provenance }),
        source: "own",
        sourceId: String(row.id),
        name: row.name,
        brand: null,
        barcode: null,
        labelSource: row.source,
        retrievedAt: null,
        mealKit: null,
      };
      references.set(record, {
        reference: { kind: "food", id: row.id },
        provenance,
      });
      return record;
    },
  );
  const cache = selectCachedFoodCandidates(database).map(
    (row): NutritionRecord => {
      const record: NutritionRecord = {
        ...fromStoredNutrition(row),
        source: row.source,
        sourceId: row.source_key,
        name: row.name,
        brand: row.brand,
        barcode: null,
        labelSource: null,
        retrievedAt: row.fetched_at,
        mealKit: null,
      };
      references.set(record, {
        reference: { kind: "source_food", id: row.id },
        provenance: row.provenance,
      });
      return record;
    },
  );
  const resolved = resolveLookup(
    {
      kind: "automatic",
      key: { kind: "name", name: input.name, brand: input.brand ?? null },
      basis: "any",
    },
    { own, cache },
  );
  if (resolved.status === "miss")
    return {
      result: resolved.reason === "ambiguous" ? "ambiguous" : "no_match",
      foods: [],
    };
  return {
    result: "match",
    foods: resolved.records.map((record) => {
      const stored = references.get(record);
      if (!stored) throw new Error("Lookup returned an unknown food reference");
      return {
        ...stored,
        name: record.name,
        brand: record.brand,
        serving: record.basis,
        nutrients: record.nutrients,
      };
    }),
  };
}
