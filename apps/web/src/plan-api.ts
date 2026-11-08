import { z } from "zod";
import { api } from "./api.ts";

const nutrientBudget = z.object({
  known_subtotal: z.number(),
  complete: z.boolean(),
  budget: z.number().nullable(),
  remaining: z.number().nullable(),
});
export const plannedItemSchema = z.object({
  id: z.number().int().positive(),
  revision: z.number().int().positive(),
  state: z.enum(["planned", "eaten", "skipped"]),
  position: z.number().int().nonnegative(),
  reference: z.object({ name: z.string() }),
  servings: z.number().positive().nullable(),
  nutrition: z.object({ status: z.enum(["known", "pending", "unknown"]) }),
});
export const planSchema = z.object({
  day: z.string(),
  slots: z.array(
    z.object({ position: z.number().int().nonnegative(), name: z.string() }),
  ),
  budgets: z.object({
    status: z.enum(["ready", "no_day_type", "needs_profile", "needs_weigh_in"]),
    slots: z.array(
      z.object({
        position: z.number().int().nonnegative(),
        ended: z.boolean(),
        kcal: nutrientBudget,
        protein_g: nutrientBudget,
      }),
    ),
  }),
  planned_items: z.array(plannedItemSchema),
});
export type Plan = z.infer<typeof planSchema>;
export type PlannedItem = z.infer<typeof plannedItemSchema>;
export type ItemAction = "ate" | "ate_three_quarters" | "skip";

export const planKey = (person: number) => ["plan", person] as const;

export async function readPlan(signal: AbortSignal) {
  return planSchema.parse(await api("/api/plan", { signal }));
}

export async function actOnItem(item: PlannedItem, action: ItemAction) {
  return z
    .object({
      item: z.object({
        id: z.literal(item.id),
        state: z.enum(["eaten", "skipped"]),
      }),
    })
    .parse(
      await api("/api/plan/items/action", {
        method: "POST",
        body: JSON.stringify({
          item_id: item.id,
          revision: item.revision,
          action,
          mutation_id: crypto.randomUUID(),
        }),
      }),
    );
}
