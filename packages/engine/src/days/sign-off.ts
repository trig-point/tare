import { z as zod } from "zod";
import { writeTransaction } from "../db.ts";
import { localDay } from "../logging/day.ts";
import {
  defineOperation,
  type OperationContext,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { appendDayNote } from "../queries/append-day-note.ts";
import { selectDay } from "../queries/select-day.ts";
import { selectUnsignedDays } from "../queries/select-unsigned-days.ts";
import { signOffDay } from "../queries/sign-off-day.ts";
import { ledgerSchema, readLedger } from "./ledger.ts";

const dayInput = zod.strictObject({ day: zod.iso.date() });
const rating = zod.number().int().min(1).max(5).nullable();
const metadata = zod.strictObject({
  day: zod.iso.date(),
  signed_off_at: zod.iso.datetime().nullable(),
  hunger: rating,
  fullness: rating,
  notes: zod.string().nullable(),
});
const shared = {
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser_and_agent",
  admin: false,
} as const;

function today(context: OperationContext) {
  const person = operationPerson(context);
  return localDay(
    context.clock.now().toISOString(),
    person.timezone,
    person.day_start_hour,
  );
}

function rejectFuture(day: string, context: OperationContext) {
  if (day > today(context)) throw new OperationError(400, "day_in_future");
}

export const daySignOffOperations = [
  defineOperation({
    ...shared,
    name: "sign_off_day",
    callerClass: "browser",
    method: "POST",
    path: "/api/days/sign-off",
    bodyLimit: 8192,
    input: dayInput.extend({
      hunger: rating.optional(),
      fullness: rating.optional(),
      notes: zod.string().nullable().optional(),
    }),
    output: metadata,
    handler(input, context) {
      rejectFuture(input.day, context);
      const body = writeTransaction(context.database, () => {
        const result = signOffDay(context.database, {
          user_id: operationPerson(context).id,
          day: input.day,
          signed_off_at: context.clock.now().toISOString(),
          hunger: input.hunger ?? null,
          fullness: input.fullness ?? null,
          notes: input.notes ?? null,
          set_hunger: Number(input.hunger !== undefined),
          set_fullness: Number(input.fullness !== undefined),
          set_notes: Number(input.notes !== undefined),
        });
        if (!result) throw new Error("Day sign-off returned no row");
        return result;
      });
      return { status: 200, body };
    },
  }),
  defineOperation({
    ...shared,
    name: "add_day_note",
    method: "POST",
    path: "/api/days/note",
    bodyLimit: 16384,
    input: dayInput.extend({ note: zod.string().trim().min(1).max(2000) }),
    output: metadata,
    handler(input, context) {
      rejectFuture(input.day, context);
      const body = writeTransaction(context.database, () => {
        const result = appendDayNote(context.database, {
          ...input,
          user_id: operationPerson(context).id,
        });
        if (!result) throw new Error("Day note returned no row");
        return result;
      });
      return { status: 200, body };
    },
  }),
  defineOperation({
    ...shared,
    name: "list_unsigned_days",
    method: "GET",
    path: "/api/days/unsigned",
    input: zod.strictObject({}),
    output: zod.strictObject({ days: zod.array(metadata) }),
    handler(_input, context) {
      return {
        status: 200,
        body: {
          days: selectUnsignedDays(context.database, {
            user_id: operationPerson(context).id,
            today: today(context),
          }),
        },
      };
    },
  }),
  defineOperation({
    ...shared,
    name: "read_day",
    method: "GET",
    path: "/api/days/:day",
    input: dayInput,
    output: ledgerSchema.extend(metadata.shape),
    handler(input, context) {
      const person = operationPerson(context);
      const stored = selectDay(context.database, {
        user_id: person.id,
        day: input.day,
      });
      return {
        status: 200,
        body: {
          ...readLedger(context.database, person.id, input.day),
          signed_off_at: stored?.signed_off_at ?? null,
          hunger: stored?.hunger ?? null,
          fullness: stored?.fullness ?? null,
          notes: stored?.notes ?? null,
        },
      };
    },
  }),
];
