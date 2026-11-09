import { z as zod } from "zod";
import { writeTransaction } from "../db.ts";
import { localDay } from "../logging/day.ts";
import {
  defineOperation,
  type OperationContext,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { deleteHabit } from "../queries/delete-habit.ts";
import { selectHabits } from "../queries/select-habits.ts";
import { selectSignals } from "../queries/select-signals.ts";
import { upsertHabit } from "../queries/upsert-habit.ts";
import { upsertSignal } from "../queries/upsert-signal.ts";
import {
  activityOperations,
  logActivity,
  readWorkouts,
  workoutOutput,
} from "./activities.ts";
import {
  habitKey,
  metricName,
  signalVocabulary,
  withUnit,
} from "./vocabulary.ts";

// SQLite length() stops at NUL, so the nonblank CHECK would fail as a 500.
const text = zod
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.includes("\u0000"));
const signalFields = {
  metric: metricName,
  value: zod.number(),
  source: text,
  unit: zod.string(),
  label: zod.string().optional(),
};
const habitFields = {
  habit_key: habitKey,
  amount: zod.number().nullable(),
  note: zod.string().nullable(),
  source: text,
  updated_at: zod.string(),
};
const base = {
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser_and_agent",
  admin: false,
  bodyLimit: 8192,
} as const;
function loggedDay(requested: string | undefined, context: OperationContext) {
  const person = operationPerson(context);
  const now = context.clock.now().toISOString();
  const today = localDay(now, person.timezone, person.day_start_hour);
  const day = requested ?? today;
  if (day > today) throw new OperationError(400, "day_in_future");
  const source = context.credential === "service" ? "agent" : "manual";
  return { person, now, day, source };
}
function knownHabit(key: string) {
  const parsed = habitKey.safeParse(key);
  if (!parsed.success) throw new OperationError(400, "unknown_habit");
  return parsed.data;
}
const logSignal = defineOperation({
  ...base,
  name: "log_signal",
  method: "POST",
  path: "/api/signals",
  input: zod
    .strictObject({
      metric: metricName,
      value: zod.number(),
      day: zod.iso.date().optional(),
    })
    .refine(
      (input) =>
        signalVocabulary[input.metric].value.safeParse(input.value).success,
    ),
  output: zod.strictObject({
    ...signalFields,
    user_id: zod.number(),
    day: zod.iso.date(),
    updated_at: zod.string(),
  }),
  handler(input, context) {
    const { person, now, day, source } = loggedDay(input.day, context);
    const stored = writeTransaction(context.database, () =>
      upsertSignal(context.database, {
        ...input,
        user_id: person.id,
        day,
        source,
        updated_at: now,
      }),
    );
    if (!stored) throw new Error("Signal upsert returned no row");
    return { status: 200, body: withUnit(stored) };
  },
});
const logHabit = defineOperation({
  ...base,
  name: "log_habit",
  description:
    "Note that a habit happened on a day. Logging the same habit again for that day replaces the note.",
  method: "POST",
  path: "/api/habits",
  input: zod.strictObject({
    habit_key: zod.string(),
    day: zod.iso.date().optional(),
    amount: zod.number().positive().optional(),
    note: text.optional(),
  }),
  output: zod.strictObject({
    ...habitFields,
    user_id: zod.number(),
    day: zod.iso.date(),
  }),
  handler(input, context) {
    const habit_key = knownHabit(input.habit_key);
    const { person, now, day, source } = loggedDay(input.day, context);
    const stored = writeTransaction(context.database, () =>
      upsertHabit(context.database, {
        user_id: person.id,
        day,
        habit_key,
        amount: input.amount ?? null,
        note: input.note ?? null,
        source,
        updated_at: now,
      }),
    );
    if (!stored) throw new Error("Habit upsert returned no row");
    return { status: 200, body: stored };
  },
});
const deleteHabitNote = defineOperation({
  ...base,
  name: "delete_habit",
  description: "Remove a habit note, leaving that day not logged.",
  method: "DELETE",
  path: "/api/habits/:day/:habit_key",
  input: zod.strictObject({ day: zod.iso.date(), habit_key: zod.string() }),
  output: zod.strictObject({
    deleted: zod.literal(true),
    day: zod.iso.date(),
    habit_key: habitKey,
  }),
  handler(input, context) {
    const owner = {
      user_id: operationPerson(context).id,
      day: input.day,
      habit_key: knownHabit(input.habit_key),
    };
    const deleted = writeTransaction(context.database, () =>
      deleteHabit(context.database, owner),
    );
    if (!deleted[0]) throw new OperationError(404, "not_found");
    return { status: 200, body: { deleted: true, ...deleted[0] } };
  },
});
const readSignals = defineOperation({
  ...base,
  name: "read_signals",
  method: "GET",
  path: "/api/signals/:day",
  input: zod.strictObject({ day: zod.iso.date() }),
  output: zod.strictObject({
    day: zod.iso.date(),
    signals: zod.array(zod.strictObject(signalFields)),
    activities: zod.array(workoutOutput),
    habits: zod.array(zod.strictObject(habitFields)),
  }),
  handler(input, context) {
    const owner = { user_id: operationPerson(context).id, day: input.day };
    return {
      status: 200,
      body: {
        day: input.day,
        signals: selectSignals(context.database, owner).map(withUnit),
        activities: readWorkouts(context.database, {
          user_id: owner.user_id,
          from: input.day,
          to: input.day,
        }),
        habits: selectHabits(context.database, owner),
      },
    };
  },
});
export const signalOperations = [
  logSignal,
  logActivity,
  logHabit,
  deleteHabitNote,
  readSignals,
  ...activityOperations,
];
