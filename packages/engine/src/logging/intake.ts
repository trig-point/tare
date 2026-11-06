import type { Person } from "../auth/middleware.ts";
import { scopeDatabase, type WriteScope } from "../db.ts";
import { OperationError } from "../operations/registry.ts";
import { selectedTemplate } from "../plan/reader.ts";
import { assignSlot, minuteOfDay } from "../plan/slots.ts";
import { insertIntakeEntry } from "../queries/insert-intake-entry.ts";
import { selectFood } from "../queries/select-food.ts";
import { selectIntakeByClient } from "../queries/select-intake-by-client.ts";
import { selectSourceFood } from "../queries/select-source-food.ts";
import { canonicalInstant, localDay } from "./day.ts";
import { type Claim, resolveProvenance } from "./provenance.ts";
import {
  type Numbers,
  numbersFrom,
  nutrientKeys,
  validateNumbers,
} from "./schemas.ts";

export interface Clock {
  now(): Date;
}
export type Reference = { kind: "food" | "source_food"; id: number };
export type IntakeInput = {
  client_id: string;
  eaten_at?: string;
  portion_note?: string | null;
  slot?: { template_id: number; position: number };
} & (
  | { reference: Reference; servings: number; claim: Pick<Claim, "provenance"> }
  | { name: string; numbers: Numbers; claim: Claim }
);
export function referenceSnapshot(
  scope: WriteScope,
  person: Person,
  reference: Reference,
  servings: number,
  claim: Claim = {},
) {
  const database = scopeDatabase(scope);
  const food =
    reference.kind === "food"
      ? selectFood(database, { user_id: person.id, id: reference.id })
      : selectSourceFood(database, { id: reference.id });
  if (!food) throw new OperationError(404, "food_not_found");
  const numbers = numbersFrom(food);
  for (const key of nutrientKeys) {
    const value = numbers[key];
    numbers[key] = value === null ? null : value * servings;
  }
  if (
    nutrientKeys.some(
      (key) => numbers[key] !== null && !Number.isFinite(numbers[key]),
    )
  )
    throw new OperationError(400, "invalid_request");
  return {
    ...numbers,
    name: food.name,
    source: food.source,
    provenance: resolveProvenance(claim, food),
  };
}

export function insertIntake(
  scope: WriteScope,
  person: Person,
  input: IntakeInput,
  clock: Clock,
) {
  const database = scopeDatabase(scope);
  if (!("reference" in input)) resolveProvenance(input.claim, null);
  const replay = selectIntakeByClient(database, {
    user_id: person.id,
    client_id: input.client_id,
  });
  if (replay) return { entry: replay, created: false };
  const now = clock.now().toISOString();
  const eaten_at = canonicalInstant(input.eaten_at ?? now);
  let snapshot: Numbers & {
    name: string;
    provenance: string;
    source: string | null;
  };
  if ("reference" in input) {
    snapshot = referenceSnapshot(
      scope,
      person,
      input.reference,
      input.servings,
      input.claim,
    );
  } else {
    validateNumbers(input.numbers);
    snapshot = {
      ...input.numbers,
      name: input.name.trim(),
      provenance: resolveProvenance(input.claim, null),
      source: input.claim.source ?? null,
    };
    if (!snapshot.name) throw new OperationError(400, "invalid_request");
  }
  const day = localDay(eaten_at, person.timezone, person.day_start_hour);
  const plan = selectedTemplate(database, person, day, clock.now());
  const slot =
    input.slot === undefined
      ? assignSlot(plan.slots, minuteOfDay(eaten_at, person))
      : plan.slots.find(
          (slot) =>
            slot.template_id === input.slot?.template_id &&
            slot.position === input.slot.position,
        );
  if (input.slot !== undefined && !slot)
    throw new OperationError(400, "slot_not_found");
  const inserted = insertIntakeEntry(database, {
    ...snapshot,
    user_id: person.id,
    client_id: input.client_id,
    food_id:
      "reference" in input && input.reference.kind === "food"
        ? input.reference.id
        : null,
    source_food_id:
      "reference" in input && input.reference.kind === "source_food"
        ? input.reference.id
        : null,
    servings: "reference" in input ? input.servings : null,
    eaten_at,
    day,
    slot_template_id: slot?.template_id ?? null,
    slot_position: slot?.position ?? null,
    portion_note: input.portion_note ?? null,
    created_at: now,
    updated_at: now,
  });
  const entry =
    inserted ??
    selectIntakeByClient(database, {
      user_id: person.id,
      client_id: input.client_id,
    });
  if (!entry) throw new Error("Intake insert returned no entry");
  return { entry, created: inserted !== null };
}
