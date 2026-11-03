import type { z as zod } from "zod";
import type { Person } from "../auth/middleware.ts";
import { scopeDatabase, type WriteScope } from "../db.ts";
import { insertWeight as insertWeightRow } from "../queries/insert-weight.ts";
import { selectWeightByClient } from "../queries/select-weight-by-client.ts";
import { canonicalInstant, localDay } from "./day.ts";
import type { Clock } from "./intake.ts";
import type { logWeightInput } from "./schemas.ts";

export function insertWeight(
  scope: WriteScope,
  person: Person,
  input: zod.output<typeof logWeightInput>,
  clock: Clock,
) {
  const database = scopeDatabase(scope);
  const replay = selectWeightByClient(database, {
    user_id: person.id,
    client_id: input.client_id,
  });
  if (replay) return { entry: replay, created: false };
  const now = clock.now().toISOString();
  const measured_at = canonicalInstant(input.measured_at ?? now);
  const inserted = insertWeightRow(database, {
    ...input,
    user_id: person.id,
    measured_at,
    day: localDay(measured_at, person.timezone, person.day_start_hour),
    body_fat_pct: input.body_fat_pct ?? null,
    source: input.source ?? null,
    created_at: now,
  });
  const entry =
    inserted ??
    selectWeightByClient(database, {
      user_id: person.id,
      client_id: input.client_id,
    });
  if (!entry) throw new Error("Weight insert returned no entry");
  return { entry, created: inserted !== null };
}
