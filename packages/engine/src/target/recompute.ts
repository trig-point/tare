import type { Person } from "../auth/middleware.ts";
import type { TdeeSettings } from "../config.ts";
import { scopeDatabase, type WriteScope } from "../db.ts";
import { deleteTargetResults } from "../queries/delete-target-results.ts";
import { insertTargetNotice } from "../queries/insert-target-notice.ts";
import { insertTargetResult } from "../queries/insert-target-result.ts";
import { selectTargetResult } from "../queries/select-target-result.ts";
import { readAdaptive } from "./adaptive.ts";
import { liveFormula } from "./live-formula.ts";

export function recomputeTarget(
  scope: WriteScope,
  person: Person,
  now: Date,
  settings: TdeeSettings,
  trigger: "weekly" | "profile",
) {
  const database = scopeDatabase(scope);
  const formula = liveFormula(database, person, now);
  if (formula.status !== "ready") {
    deleteTargetResults(database, { user_id: person.id });
    return { stored: false };
  }
  const adaptive = readAdaptive(database, person, now, settings);
  const eligible = adaptive.status === "eligible";
  // The old target is what today showed: the stored target, else the live formula.
  const previous =
    selectTargetResult(database, { user_id: person.id }) ?? formula;
  const kcal = eligible
    ? Math.round(
        (adaptive.tdee_kcal + (formula.profile.goal_rate_kg_week * 7700) / 7) /
          10,
      ) * 10
    : formula.kcal;
  if (kcal !== previous.kcal || formula.protein_g !== previous.protein_g)
    insertTargetNotice(database, {
      user_id: person.id,
      created_at: now.toISOString(),
      old_kcal: previous.kcal,
      old_protein_g: previous.protein_g,
      new_kcal: kcal,
      new_protein_g: formula.protein_g,
    });
  insertTargetResult(database, {
    user_id: person.id,
    computed_at: now.toISOString(),
    trigger,
    kcal,
    protein_g: formula.protein_g,
    basis: eligible ? "adaptive" : "formula",
    tdee_kcal: eligible ? adaptive.tdee_kcal : null,
    low_kcal: eligible ? adaptive.low_kcal : null,
    high_kcal: eligible ? adaptive.high_kcal : null,
  });
  return { stored: true };
}
