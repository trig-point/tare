import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import { intakeRow } from "../logging/schemas.ts";
import { selectLedgerEntries } from "../queries/select-ledger-entries.ts";

const totalSchema = zod.strictObject({
  total: zod.number().nullable(),
  complete: zod.boolean(),
  known_subtotal: zod.number(),
});
const totalKeys = ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"] as const;
export const ledgerSchema = zod.strictObject({
  day: zod.string(),
  entries: zod.array(intakeRow),
  totals: zod.strictObject({
    kcal: totalSchema,
    protein_g: totalSchema,
    carbs_g: totalSchema,
    fat_g: totalSchema,
    fiber_g: totalSchema,
  }),
});

export function readLedger(database: Database, personId: number, day: string) {
  const entries = selectLedgerEntries(database, { user_id: personId, day });
  const totals = Object.fromEntries(
    totalKeys.map((key) => {
      let known = 0;
      let subtotal = 0;
      for (const entry of entries) {
        const value = entry[key];
        if (value !== null) {
          known += 1;
          subtotal += value;
        }
      }
      const complete = known === entries.length;
      return [
        key,
        {
          total: complete ? subtotal : null,
          complete,
          known_subtotal: subtotal,
        },
      ];
    }),
  ) as zod.infer<typeof ledgerSchema>["totals"];
  return { day, entries, totals };
}
