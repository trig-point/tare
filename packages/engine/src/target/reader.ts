import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import type { Person } from "../auth/middleware.ts";
import type { Config } from "../config.ts";
import { localDay } from "../logging/day.ts";
import { selectTargetResult } from "../queries/select-target-result.ts";
import { activityBonus, bonusSchema } from "./activity-bonus.ts";
import { adaptiveSchema, readAdaptive } from "./adaptive.ts";
import { liveFormula } from "./live-formula.ts";

export const targetSchema = zod.discriminatedUnion("status", [
  zod.strictObject({
    status: zod.literal("ready"),
    kcal: zod.number(),
    base_kcal: zod.number(),
    bonus: bonusSchema,
    protein_g: zod.number(),
    trend_kg: zod.number(),
    basis: zod.enum(["weekly_adaptive", "weekly_formula", "live_formula"]),
    adaptive: adaptiveSchema,
  }),
  zod.strictObject({
    status: zod.literal("needs_profile"),
    adaptive: adaptiveSchema,
  }),
  zod.strictObject({
    status: zod.literal("needs_weigh_in"),
    adaptive: adaptiveSchema,
  }),
]);

export function readTarget(
  database: Database,
  person: Person,
  now: Date,
  config: Pick<Config, "tdee" | "activityCredit" | "activityBonusCap">,
): zod.infer<typeof targetSchema> {
  const formula = liveFormula(database, person, now);
  const adaptive = readAdaptive(database, person, now, config.tdee);
  if (formula.status !== "ready") return { status: formula.status, adaptive };
  const stored = selectTargetResult(database, { user_id: person.id });
  const base = stored?.kcal ?? formula.kcal;
  const today = localDay(
    now.toISOString(),
    person.timezone,
    person.day_start_hour,
  );
  const bonus = activityBonus(database, { user_id: person.id, today }, config);
  return {
    status: "ready",
    kcal: base + bonus.kcal,
    base_kcal: base,
    bonus,
    protein_g: stored?.protein_g ?? formula.protein_g,
    trend_kg: formula.trend_kg,
    basis: stored
      ? stored.basis === "adaptive"
        ? "weekly_adaptive"
        : "weekly_formula"
      : "live_formula",
    adaptive,
  };
}
