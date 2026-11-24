import type { Database } from "better-sqlite3";
import { z } from "zod";
import { writeTransaction } from "../db.ts";
import { canonicalInstant, shiftDay } from "../logging/day.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { deleteHold } from "../queries/medications/delete-hold.ts";
import { insertHold } from "../queries/medications/insert-hold.ts";
import { listDoses } from "../queries/medications/list-doses.ts";
import { listHolds } from "../queries/medications/list-holds.ts";
import { listMedications } from "../queries/medications/list-medications.ts";
import { listRevisions } from "../queries/medications/list-revisions.ts";
import { shortenHold } from "../queries/medications/shorten-hold.ts";
import { selectUser } from "../queries/select-user.ts";
import {
  doseSchema,
  holdSchema,
  medicationSchema,
  readDose,
  readMedication,
} from "./read.ts";
import { nextSlot, scheduleDays, scheduleTimes, slotKey } from "./schedule.ts";
import {
  changeDose,
  generate,
  recordTakenDose,
  requireMedication,
  saveMedication,
  tareDay,
  undoDose,
} from "./store.ts";

const shared = {
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser_and_agent",
  admin: false,
  bodyLimit: 32_768,
} as const;
const id = z.number().int().positive();
const identifier = z.union([id, z.uuid()]);
const date = z.iso.date();
const empty = z.strictObject({});
const write = { ...shared, method: "POST" } as const;
function mcpInput(schema: z.ZodObject) {
  return z.looseObject(
    Object.fromEntries(
      Object.keys(schema.shape).map((key) => [key, z.unknown().optional()]),
    ),
  );
}

const medicationInput = z.strictObject({
  id: id.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  active: z.boolean().optional(),
  late_after_minutes: z.number().int().min(0).max(20_160).optional(),
  days: scheduleDays.optional(),
  times: scheduleTimes.optional(),
});
const saveHoldInput = z.strictObject({
  medication_id: id,
  id: id.optional(),
  from_date: date.optional(),
  to_date: date,
});
const deleteHoldInput = z.strictObject({ medication_id: id, id });

const doseOutput = z.strictObject({ dose: doseSchema });
const conflict = (code = "invalid_dose_state") => new OperationError(409, code);

function getDose(database: Database, identifier: string | number, now: string) {
  for (const medication of listMedications(database)) {
    generate(database, medication, now);
    const doses = listDoses(database, { medication_id: medication.id });
    const dose = doses.find(
      (row) => row.id === identifier || row.public_key === identifier,
    );
    if (dose) return { medication, dose, doses };
  }
  throw new OperationError(404, "not_found");
}

const doseActions = [
  { name: "log_dose", suffix: "log" },
  { name: "skip_dose", suffix: "skip" },
  { name: "undo_dose", suffix: "undo" },
  { name: "snooze_dose", suffix: "snooze" },
] as const;

const snoozeFields = {
  minutes: z.number().int().positive().max(20_160).optional(),
  until: z.string().optional(),
};
const doseInputs = {
  log_dose: z.strictObject({
    dose: identifier,
    taken_at: z.string().optional(),
    replace: z.boolean().optional(),
  }),
  skip_dose: z.strictObject({ dose: identifier }),
  undo_dose: z.strictObject({ dose: identifier }),
  snooze_dose: z.strictObject({ dose: identifier, ...snoozeFields }),
};

export const medicationOperations = [
  defineOperation({
    ...shared,
    name: "list_medications",
    method: "GET",
    path: "/api/medications",
    input: empty,
    mcpInput: mcpInput(empty),
    output: z.strictObject({ medications: z.array(medicationSchema) }),
    handler(_input, context) {
      const person = operationPerson(context);
      const now = context.clock.now().toISOString();
      return {
        status: 200,
        body: {
          medications: listMedications(context.database).map((medication) =>
            readMedication(context.database, medication, person, now),
          ),
        },
      };
    },
  }),
  defineOperation({
    ...write,
    name: "save_medication",
    path: "/api/medications/save",
    description:
      "Create with name, weekday days and HH:MM times, or edit a medication by id.",
    input: medicationInput,
    mcpInput: mcpInput(medicationInput),
    output: z.strictObject({ medication: medicationSchema }),
    handler(input, context) {
      const { database } = context;
      const { id } = operationPerson(context);
      try {
        const medication = writeTransaction(database, () => {
          const person = selectUser(database, { id });
          if (!person) throw new OperationError(401, "unauthenticated");
          const now = context.clock.now().toISOString();
          const savedId = saveMedication(database, person, now, input);
          return readMedication(
            database,
            requireMedication(database, savedId),
            person,
            now,
          );
        });
        return { status: 200, body: { medication } };
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "SQLITE_CONSTRAINT_UNIQUE" &&
          error.message.endsWith("medications.name")
        )
          throw conflict("medication_exists");
        throw error;
      }
    },
  }),
  ...doseActions.map(({ name, suffix }) =>
    defineOperation({
      ...write,
      name,
      path: `/api/medications/doses/${suffix}`,
      input: doseInputs[name],
      mcpInput: mcpInput(doseInputs[name]),
      output: doseOutput,
      handler(input, context) {
        const { database } = context;
        const person = operationPerson(context);
        const now = context.clock.now().toISOString();
        return writeTransaction(database, () => {
          const { medication, dose, doses } = getDose(
            database,
            input.dose,
            now,
          );
          const revisions = () =>
            listRevisions(database, { medication_id: medication.id });
          let updated: typeof dose;
          switch (name) {
            case "log_dose": {
              const args = doseInputs.log_dose.parse(input);
              if (dose.status === "taken" && !args.replace)
                throw conflict("dose_exists");
              const taken =
                args.taken_at === undefined
                  ? now
                  : canonicalInstant(args.taken_at);
              if (
                taken.length !== now.length ||
                Date.parse(taken) > Date.parse(now)
              )
                throw new OperationError(400, "invalid_time");
              updated = recordTakenDose(database, dose, taken, now);
              break;
            }
            case "skip_dose":
              if (dose.status !== "scheduled") throw conflict();
              updated = changeDose(
                database,
                dose,
                "skipped",
                null,
                "user",
                dose.scheduled_at,
                now,
              );
              break;
            case "undo_dose": {
              updated = undoDose(database, medication, dose, now);
              break;
            }
            case "snooze_dose": {
              const { minutes, until } = doseInputs.snooze_dose.parse(input);
              if ((minutes === undefined) === (until === undefined))
                throw new OperationError(400, "invalid_request");
              if (!medication.active || dose.status !== "scheduled")
                throw conflict();
              const base = now > dose.scheduled_at ? now : dose.scheduled_at;
              const target =
                until === undefined
                  ? new Date(
                      Date.parse(base) + (minutes ?? 0) * 60_000,
                    ).toISOString()
                  : canonicalInstant(until);
              const next = nextSlot(revisions(), dose.slot_at, dose);
              const nextStored = doses.find(
                (row) =>
                  row.id !== dose.id &&
                  row.status === "scheduled" &&
                  (row.scheduled_at > dose.scheduled_at ||
                    (row.scheduled_at === dose.scheduled_at &&
                      slotKey(row) > slotKey(dose))),
              );
              if (
                target <= base ||
                (next && target >= next.slot_at) ||
                (nextStored && target >= nextStored.scheduled_at)
              )
                throw new OperationError(400, "invalid_time");
              updated = changeDose(
                database,
                dose,
                "scheduled",
                null,
                null,
                target,
              );
              break;
            }
          }
          return {
            status: 200,
            body: {
              dose: readDose(
                updated,
                medication,
                listHolds(database, { medication_id: medication.id }),
                person,
                now,
              ),
            },
          };
        });
      },
    }),
  ),
  defineOperation({
    ...write,
    name: "save_hold",
    path: "/api/medications/holds/save",
    input: saveHoldInput,
    mcpInput: mcpInput(saveHoldInput),
    output: z.strictObject({ hold: holdSchema }),
    handler(input, context) {
      const { database } = context;
      const now = context.clock.now().toISOString();
      const today = tareDay(now, operationPerson(context));
      return writeTransaction(database, () => {
        const medication = requireMedication(database, input.medication_id);
        if (!medication.active) throw conflict("medication_inactive");
        generate(database, medication, now);
        let hold: z.infer<typeof holdSchema> | null | undefined;
        if (input.id === undefined) {
          if (
            !input.from_date ||
            input.from_date < today ||
            input.to_date < input.from_date
          )
            throw new OperationError(400, "invalid_request");
          hold = insertHold(database, { ...input, from_date: input.from_date });
        } else {
          const existing = listHolds(database, input).find(
            (row) => row.id === input.id,
          );
          if (!existing) throw new OperationError(404, "not_found");
          if (
            (input.from_date !== undefined &&
              input.from_date !== existing.from_date) ||
            input.to_date < shiftDay(today, -1) ||
            input.to_date < shiftDay(existing.from_date, -1) ||
            input.to_date > existing.to_date
          )
            throw new OperationError(400, "invalid_request");
          hold = shortenHold(database, { to_date: input.to_date }, existing);
        }
        if (!hold) throw new Error("Missing saved hold");
        return { status: 200, body: { hold } };
      });
    },
  }),
  defineOperation({
    ...write,
    name: "delete_hold",
    path: "/api/medications/holds/delete",
    input: deleteHoldInput,
    mcpInput: mcpInput(deleteHoldInput),
    output: empty,
    handler(input, context) {
      const { database } = context;
      const now = context.clock.now().toISOString();
      const today = tareDay(now, operationPerson(context));
      return writeTransaction(database, () => {
        const medication = requireMedication(database, input.medication_id);
        if (!medication.active) throw conflict("medication_inactive");
        generate(database, medication, now);
        const hold = listHolds(database, input).find(
          (row) => row.id === input.id,
        );
        if (!hold) throw new OperationError(404, "not_found");
        if (today >= hold.from_date) throw conflict("hold_started");
        deleteHold(database, hold);
        return { status: 200, body: {} };
      });
    },
  }),
];
