import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import { writeTransaction } from "../db.ts";
import { canonicalInstant } from "../logging/day.ts";
import { type Clock, insertIntake } from "../logging/intake.ts";
import {
  logFoodInput,
  logWeightInput,
  numbersFrom,
} from "../logging/schemas.ts";
import { insertWeight } from "../logging/weight.ts";
import { OperationError, operationPerson } from "../operations/registry.ts";
import { fillImportDay } from "../queries/fill-import-day.ts";
import { selectDay } from "../queries/select-day.ts";
import { selectPerson } from "../queries/select-person.ts";
import { selectUserByUsername } from "../queries/select-user-by-username.ts";

const clientId = zod.string().trim().min(1).max(200);
const intake = zod
  .strictObject({
    ...logFoodInput.shape,
    client_id: clientId,
    eaten_at: zod.string(),
    name: zod.string().trim().min(1),
    provenance: zod.enum(["estimated", "label"]),
  })
  .omit({
    food_id: true,
    source_food_id: true,
    servings: true,
    portion_note: true,
  });
const weight = logWeightInput.extend({
  client_id: clientId,
  measured_at: zod.string(),
  source: zod.string().trim().min(1),
});
const days = zod.strictObject({
  day: zod.iso.date(),
  hunger: zod.number().int().min(1).max(5).optional(),
  fullness: zod.number().int().min(1).max(5).optional(),
  notes: zod.string().trim().min(1).max(2000).optional(),
});
export type ImportKind = "intake" | "weight" | "days";
export type ImportFiles = Partial<Record<ImportKind, string>>;
export interface ImportSummary {
  kind: ImportKind;
  applied: number;
  replayed: number;
  skipped: number;
  errors: { line: number; code: string }[];
}

function checkedInstant(value: string, clock: Clock) {
  const instant = canonicalInstant(value);
  const timestamp = Date.parse(instant);
  if (timestamp < 0 || timestamp > clock.now().getTime() + 86_400_000)
    throw new OperationError(400, "invalid_time");
  return instant;
}

export async function importFiles(
  database: Database,
  username: string,
  files: ImportFiles,
  clock: Clock = { now: () => new Date() },
): Promise<ImportSummary[]> {
  const userId = selectUserByUsername(database, { username })?.id;
  const safePerson =
    userId === undefined ? null : selectPerson(database, { id: userId });
  if (!safePerson) throw new OperationError(400, "unknown_person");
  const person = operationPerson({ person: safePerson, credential: undefined });
  const summaries: ImportSummary[] = [];
  for (const kind of ["intake", "weight", "days"] as const) {
    const path = files[kind];
    if (path === undefined) continue;
    const summary: ImportSummary = {
      kind,
      applied: 0,
      replayed: 0,
      skipped: 0,
      errors: [],
    };
    const stream = createReadStream(path, { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let line = 0;
    try {
      for await (const text of lines) {
        line += 1;
        try {
          const raw: unknown = JSON.parse(text);
          const created = writeTransaction(database, (scope) => {
            if (kind === "intake") {
              const input = intake.parse(raw);
              logFoodInput.parse(input);
              return insertIntake(
                scope,
                person,
                {
                  client_id: input.client_id,
                  eaten_at: checkedInstant(input.eaten_at, clock),
                  name: input.name,
                  numbers: numbersFrom(input),
                  claim: { provenance: input.provenance, source: input.source },
                },
                clock,
                "suppress",
              ).created;
            }
            if (kind === "weight") {
              const input = weight.parse(raw);
              return insertWeight(
                scope,
                person,
                {
                  ...input,
                  measured_at: checkedInstant(input.measured_at, clock),
                },
                clock,
              ).created;
            }
            const input = days.parse(raw);
            const stored = selectDay(database, {
              user_id: person.id,
              day: input.day,
            });
            const existing = stored && {
              ...stored,
              notes: stored.notes || null,
            };
            const fields = ["hunger", "fullness", "notes"] as const;
            for (const field of fields)
              if (
                input[field] !== undefined &&
                existing?.[field] != null &&
                existing[field] !== input[field]
              )
                throw new OperationError(409, "conflict");
            if (
              existing &&
              fields.every(
                (field) =>
                  input[field] === undefined ||
                  existing[field] === input[field],
              )
            )
              return false;
            fillImportDay(database, {
              user_id: person.id,
              day: input.day,
              hunger: input.hunger ?? null,
              fullness: input.fullness ?? null,
              notes: input.notes ?? null,
            });
            return true;
          });
          if (created) summary.applied += 1;
          else summary.replayed += 1;
        } catch (error) {
          const code =
            error instanceof OperationError
              ? error.code
              : error instanceof RangeError
                ? "invalid_time"
                : error instanceof SyntaxError || error instanceof zod.ZodError
                  ? "invalid_row"
                  : "write_failed";
          summary.errors.push({ line, code });
          summary.skipped += 1;
        }
      }
    } finally {
      lines.close();
      stream.destroy();
    }
    summaries.push(summary);
  }
  return summaries;
}
