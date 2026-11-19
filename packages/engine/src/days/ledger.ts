import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import { intakeRow } from "../logging/schemas.ts";
import { selectLedgerEntries } from "../queries/select-ledger-entries.ts";
import type { targetSchema } from "../target/reader.ts";

const totalSchema = zod.strictObject({
  total: zod.number().nullable(),
  complete: zod.boolean(),
  known_subtotal: zod.number(),
});
const totalKeys = ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"] as const;
export const ledgerTotalsSchema = zod.strictObject({
  kcal: totalSchema,
  protein_g: totalSchema,
  carbs_g: totalSchema,
  fat_g: totalSchema,
  fiber_g: totalSchema,
});
export const ledgerSchema = zod.strictObject({
  day: zod.string(),
  entries: zod.array(intakeRow),
  totals: ledgerTotalsSchema,
});

export function ledgerTotals(
  entries: ReadonlyArray<
    Pick<zod.infer<typeof intakeRow>, (typeof totalKeys)[number]>
  >,
  checkSubtotal?: (subtotal: number, part: number) => void,
) {
  return Object.fromEntries(
    totalKeys.map((key) => {
      let known = 0;
      let subtotal = 0;
      for (const [index, entry] of entries.entries()) {
        const value = entry[key];
        if (value !== null) {
          known += 1;
          subtotal += value;
          checkSubtotal?.(subtotal, index + 1);
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
  ) as zod.infer<typeof ledgerTotalsSchema>;
}

export function readLedger(database: Database, personId: number, day: string) {
  const entries = selectLedgerEntries(database, { user_id: personId, day });
  return { day, entries, totals: ledgerTotals(entries) };
}

export function remainingFor(
  target: zod.infer<typeof targetSchema>,
  totals: zod.infer<typeof ledgerSchema>["totals"],
  key: "kcal" | "protein_g",
): number | null {
  const total = totals[key];
  return target.status === "ready" && total.complete && total.total !== null
    ? target[key] - total.total
    : null;
}
