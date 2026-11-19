import type { Person } from "../auth/middleware.ts";
import { scopeDatabase, type WriteScope } from "../db.ts";
import { OperationError } from "../operations/registry.ts";
import type { PantryStock, StockOutcome } from "../pantry/requests.ts";
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
type ServingRange = { low: number; high: number };
const measuredAmount = {
  amount_estimated: 0,
  servings_low: null,
  servings_high: null,
} as const;

export function readServingRange(
  servings: number,
  low?: number,
  high?: number,
): ServingRange | null {
  if (low === undefined && high === undefined) return null;
  if (
    low === undefined ||
    high === undefined ||
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    low <= 0 ||
    low > servings ||
    servings > high
  )
    throw new OperationError(400, "invalid_bounds");
  return { low, high };
}

export type IntakeInput = {
  client_id: string;
  eaten_at?: string;
  portion_note?: string | null;
  slot?: { template_id: number; position: number };
} & (
  | {
      reference: Reference;
      servings: number;
      claim: Pick<Claim, "provenance">;
      estimatedRange?: ServingRange | null;
    }
  | { name: string; numbers: Numbers; claim: Claim }
);
export function referenceSnapshot(
  scope: WriteScope,
  person: Person,
  reference: Reference,
  servings: number,
  claim: Claim = {},
  estimatedRange?: ServingRange | null,
) {
  const database = scopeDatabase(scope);
  const food =
    reference.kind === "food"
      ? selectFood(database, { user_id: person.id, id: reference.id })
      : selectSourceFood(database, { id: reference.id });
  if (!food) throw new OperationError(404, "food_not_found");
  const perServing = numbersFrom(food);
  const numbers = { ...perServing };
  for (const key of nutrientKeys) {
    const value = numbers[key];
    numbers[key] = value === null ? null : value * servings;
  }
  if (estimatedRange !== undefined) {
    numbers.kcal_low =
      estimatedRange && food.kcal !== null
        ? (perServing.kcal_low ?? food.kcal) * estimatedRange.low
        : null;
    numbers.kcal_high =
      estimatedRange && food.kcal !== null
        ? (perServing.kcal_high ?? food.kcal) * estimatedRange.high
        : null;
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
    provenance:
      estimatedRange === undefined
        ? resolveProvenance(claim, food)
        : "estimated",
    ...(estimatedRange === undefined
      ? measuredAmount
      : {
          amount_estimated: 1 as const,
          servings_low: estimatedRange?.low ?? null,
          servings_high: estimatedRange?.high ?? null,
        }),
  };
}

type Inserted = ReturnType<typeof writeIntake>;
/** `suppress` writes nutrition only; a pantry stock records the outcome in the same scope. */
export function insertIntake(
  scope: WriteScope,
  person: Person,
  input: IntakeInput,
  clock: Clock,
  stock: "suppress",
): Inserted;
export function insertIntake(
  scope: WriteScope,
  person: Person,
  input: IntakeInput,
  clock: Clock,
  stock: PantryStock,
): Inserted & { stock: StockOutcome | null };
export function insertIntake(
  scope: WriteScope,
  person: Person,
  input: IntakeInput,
  clock: Clock,
  stock: "suppress" | PantryStock,
) {
  const result = writeIntake(scope, person, input, clock);
  if (stock === "suppress") return result;
  return {
    ...result,
    stock:
      result.entry.amount_estimated === 1
        ? null
        : stock.record(scope, person.id, result.entry, result.created),
  };
}

function writeIntake(
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
  const instant = clock.now();
  const now = instant.toISOString();
  const eaten_at = canonicalInstant(input.eaten_at ?? now);
  let snapshot: ReturnType<typeof referenceSnapshot>;
  if ("reference" in input) {
    snapshot = referenceSnapshot(
      scope,
      person,
      input.reference,
      input.servings,
      input.claim,
      input.estimatedRange,
    );
  } else {
    validateNumbers(input.numbers);
    snapshot = {
      ...measuredAmount,
      ...input.numbers,
      name: input.name.trim(),
      provenance: resolveProvenance(input.claim, null),
      source: input.claim.source ?? null,
    };
    if (!snapshot.name) throw new OperationError(400, "invalid_request");
  }
  const day = localDay(eaten_at, person.timezone, person.day_start_hour);
  const plan = selectedTemplate(database, person, day, instant);
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
