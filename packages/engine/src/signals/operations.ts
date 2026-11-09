import { z as zod } from "zod";
import { writeTransaction } from "../db.ts";
import { localDay } from "../logging/day.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { selectSignals } from "../queries/select-signals.ts";
import { upsertSignal } from "../queries/upsert-signal.ts";
import {
  activityOperations,
  logActivity,
  readWorkouts,
  workoutOutput,
} from "./activities.ts";
import { metricName, signalVocabulary, withUnit } from "./vocabulary.ts";

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
const base = {
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser_and_agent",
  admin: false,
  bodyLimit: 8192,
} as const;
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
    const person = operationPerson(context);
    const now = context.clock.now().toISOString();
    const today = localDay(now, person.timezone, person.day_start_hour);
    const day = input.day ?? today;
    if (day > today) throw new OperationError(400, "day_in_future");
    const stored = writeTransaction(context.database, () =>
      upsertSignal(context.database, {
        ...input,
        user_id: person.id,
        day,
        source: context.credential === "service" ? "agent" : "manual",
        updated_at: now,
      }),
    );
    if (!stored) throw new Error("Signal upsert returned no row");
    return { status: 200, body: withUnit(stored) };
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
      },
    };
  },
});
export const signalOperations = [
  logSignal,
  logActivity,
  readSignals,
  ...activityOperations,
];
