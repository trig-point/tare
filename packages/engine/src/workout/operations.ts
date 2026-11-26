import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import { writeTransaction } from "../db.ts";
import { localDay } from "../logging/day.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { selectWorkoutSchedule } from "../queries/workout/select-workout-schedule.ts";
import { upsertWorkoutSchedule } from "../queries/workout/upsert-workout-schedule.ts";
import { findMovement, type MovementCard, movementCard } from "./movements.ts";
import {
  chooseSession,
  movement,
  resolveToday,
  type ScheduleDocument,
  scheduleDocument,
  sessionAlternates,
  sessionKey,
  todayEntry,
} from "./schedule.ts";

const documentLimit = 60_000;
const todayWorkout = todayEntry.extend({
  alternates: zod.array(
    zod.strictObject({
      key: zod.string(),
      name: zod.string(),
      where: zod.string(),
    }),
  ),
  movements: zod.array(movement.extend({ card: movementCard.nullable() })),
});

const shared = {
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser_and_agent",
  admin: false,
} as const;

export function readSchedule(
  database: Database,
  userId: number,
): ScheduleDocument | null {
  const row = selectWorkoutSchedule(database, { user_id: userId });
  if (!row) return null;
  return scheduleDocument.parse({
    ...JSON.parse(row.document),
    updated: row.updated_at,
  });
}

export const workoutOperations = [
  defineOperation({
    ...shared,
    name: "read_workout_schedule",
    description:
      "Read the workout schedule. schedule is null when none is stored; send its updated back with a replace.",
    method: "GET",
    path: "/api/workout-schedule",
    input: zod.strictObject({}),
    output: zod.strictObject({ schedule: scheduleDocument.nullable() }),
    handler(_input, context) {
      return {
        status: 200,
        body: {
          schedule: readSchedule(context.database, operationPerson(context).id),
        },
      };
    },
  }),
  defineOperation({
    ...shared,
    name: "replace_workout_schedule",
    description:
      "Replace the whole workout schedule, up to 60 KB. Include the updated you last read; omit it only for the first write.",
    method: "POST",
    path: "/api/workout-schedule",
    bodyLimit: 65_536,
    input: scheduleDocument,
    inputIssues: true,
    output: zod.strictObject({ schedule: scheduleDocument }),
    handler(input, context) {
      const person = operationPerson(context);
      const { updated, ...document } = input;
      // Leaves room for the updated stamp and the MCP envelope, so a stored copy can always be sent back.
      if (Buffer.byteLength(JSON.stringify(document)) > documentLimit)
        throw new OperationError(413, "schedule_too_large");
      const schedule = writeTransaction(context.database, () => {
        const stored = selectWorkoutSchedule(context.database, {
          user_id: person.id,
        });
        if ((stored?.updated_at ?? undefined) !== updated)
          throw new OperationError(409, "schedule_conflict");
        // Strictly later than the stored stamp, so a stale copy never matches a newer write.
        const stamp = new Date(
          Math.max(
            context.clock.now().getTime(),
            stored ? Date.parse(stored.updated_at) + 1 : 0,
          ),
        ).toISOString();
        const row = upsertWorkoutSchedule(context.database, {
          user_id: person.id,
          document: JSON.stringify(document),
          updated_at: stamp,
        });
        if (!row) throw new Error("Schedule save returned no row");
        return { ...document, updated: row.updated_at };
      });
      return { status: 200, body: { schedule } };
    },
  }),
  defineOperation({
    ...shared,
    name: "today_workout",
    description:
      "Today's workout: the dated entry, else the weekday template, with movements. Each movement's card is its library card, null when none matches its name. alternates lists the sessions that can stand in for it; pass one as session to get its movements. today is null when no schedule is stored.",
    method: "GET",
    path: "/api/workout-schedule/today/:session?",
    input: zod.strictObject({ session: sessionKey.optional() }),
    output: zod.strictObject({ today: todayWorkout.nullable() }),
    handler(input, context) {
      const person = operationPerson(context);
      return {
        status: 200,
        body: {
          today: workoutToday(
            context.database,
            person,
            context.clock.now(),
            input.session,
          ),
        },
      };
    },
  }),
];

export function workoutToday(
  database: Database,
  person: { id: number; timezone: string; day_start_hour: number },
  now: Date,
  session?: string,
) {
  const schedule = readSchedule(database, person.id);
  if (!schedule && session !== undefined)
    throw new OperationError(400, "session_not_scheduled");
  if (!schedule) return null;
  const scheduled = resolveToday(
    schedule,
    localDay(now.toISOString(), person.timezone, person.day_start_hour),
  );
  const today =
    session === undefined
      ? scheduled
      : chooseSession(schedule, scheduled, session);
  if (!today) throw new OperationError(400, "session_not_scheduled");
  const cards = new Map<string, MovementCard | null>();
  return {
    ...today,
    alternates: sessionAlternates(schedule, scheduled),
    movements: today.movements.map((planned) => {
      const key = planned.name.trim();
      if (!cards.has(key))
        cards.set(key, findMovement(database, person.id, planned.name));
      return { ...planned, card: cards.get(key) ?? null };
    }),
  };
}
