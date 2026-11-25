import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import { emptyInput } from "../auth/routes.ts";
import { writeTransaction } from "../db.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { deleteMovement } from "../queries/movements/delete-movement.ts";
import {
  type SelectMovementResult,
  selectMovement,
} from "../queries/movements/select-movement.ts";
import { selectMovements } from "../queries/movements/select-movements.ts";
import { upsertMovement } from "../queries/movements/upsert-movement.ts";

// SQLite length() stops at NUL, so the nonblank CHECK would fail as a 500.
const text = (max: number) =>
  zod
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !value.includes("\u0000"), "must not contain NUL");
const steps = zod.array(text(300)).max(20);
const listFields = ["setup", "cues", "mistakes", "safety", "pictures"] as const;

// Matches log_activity's exercise limit, so every card can gain sessions.
const movementName = text(80);
const movementInput = zod.strictObject({
  name: movementName,
  setup: steps.optional(),
  cues: steps.optional(),
  mistakes: steps.optional(),
  safety: steps.optional(),
  pictures: zod
    .array(zod.url({ protocol: /^https?$/ }).max(2000))
    .max(10)
    .optional(),
  rest_seconds: zod.number().int().min(0).max(3600).nullish(),
  source: text(200).nullish(),
  equipment: text(300).nullish(),
});

export const movementCard = zod.strictObject({
  id: zod.number(),
  name: zod.string(),
  setup: zod.array(zod.string()),
  cues: zod.array(zod.string()),
  mistakes: zod.array(zod.string()),
  safety: zod.array(zod.string()),
  pictures: zod.array(zod.string()),
  rest_seconds: zod.number().nullable(),
  source: zod.string().nullable(),
  equipment: zod.string().nullable(),
  sessions: zod.number(),
});
export type MovementCard = zod.output<typeof movementCard>;

function toCard(row: SelectMovementResult): MovementCard {
  const lists = Object.fromEntries(
    listFields.map((field) => [field, JSON.parse(row[field]) as string[]]),
  ) as Record<(typeof listFields)[number], string[]>;
  return { ...row, ...lists, sessions: row.sessions ?? 0 };
}

export function findMovement(
  database: Database,
  userId: number,
  name: string,
): MovementCard | null {
  const [row] = selectMovement(database, {
    user_id: userId,
    name: name.trim(),
  });
  return row ? toCard(row) : null;
}

const nameInput = zod.strictObject({ name: movementName });
const shared = {
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser_and_agent",
  admin: false,
} as const;

export const movementOperations = [
  defineOperation({
    ...shared,
    name: "save_movement",
    description:
      "Save a movement card, replacing any card with the same name (case-insensitive); omitted fields are cleared. Lists are ordered strings; pictures are http(s) URLs; rest in seconds.",
    method: "POST",
    path: "/api/movements",
    bodyLimit: 65_536,
    input: movementInput,
    inputIssues: true,
    output: zod.strictObject({ movement: movementCard }),
    handler(input, context) {
      const person = operationPerson(context);
      const movement = writeTransaction(context.database, () => {
        upsertMovement(context.database, {
          user_id: person.id,
          name: input.name,
          ...(Object.fromEntries(
            listFields.map((field) => [
              field,
              JSON.stringify(input[field] ?? []),
            ]),
          ) as Record<(typeof listFields)[number], string>),
          rest_seconds: input.rest_seconds ?? null,
          source: input.source ?? null,
          equipment: input.equipment ?? null,
          updated_at: context.clock.now().toISOString(),
        });
        return findMovement(context.database, person.id, input.name);
      });
      if (!movement) throw new Error("Movement save returned no row");
      return { status: 200, body: { movement } };
    },
  }),
  defineOperation({
    ...shared,
    name: "list_movements",
    description:
      "List movement cards by name, each with sessions: the number of logged sessions with a set of that name.",
    method: "GET",
    path: "/api/movements",
    input: emptyInput,
    output: zod.strictObject({ movements: zod.array(movementCard) }),
    handler(_input, context) {
      return {
        status: 200,
        body: {
          movements: selectMovements(context.database, {
            user_id: operationPerson(context).id,
          }).map(toCard),
        },
      };
    },
  }),
  defineOperation({
    ...shared,
    name: "get_movement",
    description: "Read one movement card by name (case-insensitive).",
    method: "GET",
    path: "/api/movements/:name",
    input: nameInput,
    output: zod.strictObject({ movement: movementCard }),
    handler(input, context) {
      const movement = findMovement(
        context.database,
        operationPerson(context).id,
        input.name,
      );
      if (!movement) throw new OperationError(404, "not_found");
      return { status: 200, body: { movement } };
    },
  }),
  defineOperation({
    ...shared,
    name: "remove_movement",
    description: "Remove a movement card by name (case-insensitive).",
    method: "DELETE",
    path: "/api/movements/:name",
    input: nameInput,
    output: zod.strictObject({ deleted: zod.literal(true), id: zod.number() }),
    handler(input, context) {
      const [removed] = writeTransaction(context.database, () =>
        deleteMovement(context.database, {
          user_id: operationPerson(context).id,
          name: input.name,
        }),
      );
      if (!removed) throw new OperationError(404, "not_found");
      return { status: 200, body: { deleted: true, id: removed.id } };
    },
  }),
];
