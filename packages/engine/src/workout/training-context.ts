import { z } from "zod";
import { writeTransaction } from "../db.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { deleteLimit } from "../queries/training/delete-limit.ts";
import { deleteMachine } from "../queries/training/delete-machine.ts";
import { deletePlace } from "../queries/training/delete-place.ts";
import { findPlace } from "../queries/training/find-place.ts";
import { insertLimit } from "../queries/training/insert-limit.ts";
import { insertMachine } from "../queries/training/insert-machine.ts";
import { insertPlace } from "../queries/training/insert-place.ts";
import { listLimits } from "../queries/training/list-limits.ts";
import { listMachines } from "../queries/training/list-machines.ts";
import { listPlaces } from "../queries/training/list-places.ts";
import { recentLoggedSessions } from "../queries/training/recent-logged-sessions.ts";
import { updateLimit } from "../queries/training/update-limit.ts";
import { updateMachine } from "../queries/training/update-machine.ts";
import { updatePlace } from "../queries/training/update-place.ts";
import { readWorkouts, workoutOutput } from "../signals/activities.ts";
import { readSchedule } from "./operations.ts";
import { scheduleDocument } from "./schedule.ts";

const shared = {
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser_and_agent",
  admin: false,
} as const;

const save = { ...shared, method: "POST", bodyLimit: 60_000 } as const;
const id = z.number().int().positive();
const text = (max: number) => z.string().trim().min(1).max(max);
const notes = text(1000).nullable();
const movements = z.array(text(160)).max(50);
const photoUrls = z.array(z.url({ protocol: /^https?$/ }).max(1000)).max(10);
const status = z.enum(["active", "resolved"]);
const placeFields = z.strictObject({ name: text(80), notes });
const machineFields = placeFields.extend({
  place_id: id,
  movements,
  photo_urls: photoUrls,
});
const limitFields = z.strictObject({
  body_area: text(120),
  description: text(1000),
  movements,
  status,
  date_noted: z.iso.date(),
});
const placeOutput = placeFields.extend({ id });
const machineOutput = machineFields.extend({ id });
const limitOutput = limitFields.extend({ id });
const placeWithMachines = placeOutput.extend({
  machines: z.array(machineOutput),
});
const enrichedSchedule = scheduleDocument.safeExtend({
  sessions: z.record(
    scheduleDocument.shape.sessions.keyType,
    scheduleDocument.shape.sessions.valueType.extend({
      place: placeWithMachines.nullable(),
    }),
  ),
});

export const trainingContextOutput = z.strictObject({
  places: z.array(placeWithMachines),
  limits: z.array(limitOutput),
  schedule: enrichedSchedule.nullable(),
  recent_sessions: z.array(workoutOutput),
});

function found<Row>(row: Row | null | undefined, code = "not_found"): Row {
  if (row == null) throw new OperationError(404, code);
  return row;
}

function machineView(row: NonNullable<ReturnType<typeof insertMachine>>) {
  return {
    ...row,
    movements: movements.parse(JSON.parse(row.movements)),
    photo_urls: photoUrls.parse(JSON.parse(row.photo_urls)),
  };
}

function limitView(row: NonNullable<ReturnType<typeof insertLimit>>) {
  return {
    ...row,
    movements: movements.parse(JSON.parse(row.movements)),
    status: status.parse(row.status),
  };
}

export const trainingOperations = [
  defineOperation({
    ...save,
    name: "save_training_place",
    path: "/api/training/places",
    description:
      "Create or replace a training place. Include its id to replace it.",
    input: placeFields.extend({ id: id.optional(), notes: notes.optional() }),
    output: z.strictObject({ place: placeOutput }),
    handler(input, context) {
      const fields = {
        user_id: operationPerson(context).id,
        name: input.name,
        notes: input.notes ?? null,
      };
      const place =
        input.id === undefined
          ? insertPlace(context.database, fields)
          : updatePlace(context.database, fields, {
              user_id: fields.user_id,
              id: input.id,
            });
      return { status: 200, body: { place: found(place) } };
    },
  }),
  defineOperation({
    ...save,
    name: "save_training_machine",
    path: "/api/training/machines",
    description:
      "Create or replace a machine at an existing place. Include its id to replace it.",
    input: machineFields.extend({
      id: id.optional(),
      notes: notes.optional(),
      photo_urls: photoUrls.optional(),
      movements: movements.optional(),
    }),
    output: z.strictObject({ machine: machineOutput }),
    handler(input, context) {
      const user_id = operationPerson(context).id;
      const fields = {
        user_id,
        place_id: input.place_id,
        name: input.name,
        notes: input.notes ?? null,
        photo_urls: JSON.stringify(input.photo_urls ?? []),
        movements: JSON.stringify(input.movements ?? []),
      };
      const machine = writeTransaction(context.database, () => {
        found(
          findPlace(context.database, { user_id, id: input.place_id }),
          "place_not_found",
        );
        return input.id === undefined
          ? insertMachine(context.database, fields)
          : updateMachine(context.database, fields, { user_id, id: input.id });
      });
      return { status: 200, body: { machine: machineView(found(machine)) } };
    },
  }),
  defineOperation({
    ...save,
    name: "save_training_limit",
    path: "/api/training/limits",
    description:
      "Create or replace a training limit. Include its id to replace it or mark it resolved.",
    input: limitFields.extend({ id: id.optional() }),
    output: z.strictObject({ limit: limitOutput }),
    handler(input, context) {
      const { id: recordId, ...data } = input;
      const fields = {
        ...data,
        user_id: operationPerson(context).id,
        movements: JSON.stringify(data.movements),
      };
      const limit =
        recordId === undefined
          ? insertLimit(context.database, fields)
          : updateLimit(context.database, fields, {
              user_id: fields.user_id,
              id: recordId,
            });
      return { status: 200, body: { limit: limitView(found(limit)) } };
    },
  }),
  ...(
    [
      ["place", "places", deletePlace],
      ["machine", "machines", deleteMachine],
      ["limit", "limits", deleteLimit],
    ] as const
  ).map(([record, collection, remove]) =>
    defineOperation({
      ...shared,
      name: `remove_training_${record}`,
      method: "DELETE",
      path: `/api/training/${collection}/:id`,
      description:
        record === "place"
          ? "Remove a training place and all its machines."
          : `Remove a training ${record}.`,
      input: z.strictObject({ id: z.coerce.number().int().positive() }),
      mcpInput: z.strictObject({ id }),
      output: z.strictObject({ id, deleted: z.literal(true) }),
      handler(input, context) {
        found(
          remove(context.database, {
            user_id: operationPerson(context).id,
            id: input.id,
          }),
        );
        return { status: 200, body: { id: input.id, deleted: true } };
      },
    }),
  ),
  defineOperation({
    ...shared,
    name: "get_training_context",
    method: "GET",
    path: "/api/training/context",
    description:
      "Read training places and machines, active limits, the workout schedule and the last five logged sessions with sets.",
    input: z.strictObject({}),
    output: trainingContextOutput,
    handler(_input, context) {
      const { database } = context;
      const user_id = operationPerson(context).id;
      const machines = Map.groupBy(
        listMachines(database, { user_id }).map(machineView),
        (machine) => machine.place_id,
      );
      const places = listPlaces(database, { user_id }).map((place) => ({
        ...place,
        machines: machines.get(place.id) ?? [],
      }));
      const limits = listLimits(database, { user_id }).map(limitView);
      const schedule = readSchedule(database, user_id);
      const recent = recentLoggedSessions(database, { user_id });
      const newest = recent[0];
      const oldest = recent.at(-1);
      const workouts =
        newest && oldest
          ? readWorkouts(database, {
              user_id,
              from: oldest.day,
              to: newest.day,
            })
          : [];
      const workoutsById = new Map(
        workouts.map((session) => [session.id, session]),
      );
      return {
        status: 200,
        body: {
          places,
          limits,
          schedule: schedule && {
            ...schedule,
            sessions: Object.fromEntries(
              Object.entries(schedule.sessions).map(([sessionId, session]) => [
                sessionId,
                {
                  ...session,
                  place:
                    places.find(
                      (place) =>
                        place.name.toLowerCase() ===
                        session.where.toLowerCase(),
                    ) ?? null,
                },
              ]),
            ),
          },
          recent_sessions: recent.map(({ id }) => found(workoutsById.get(id))),
        },
      };
    },
  }),
];
