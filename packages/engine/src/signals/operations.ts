import { z as zod } from "zod";
import { writeTransaction } from "../db.ts";
import { canonicalInstant, localDay } from "../logging/day.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { insertActivity } from "../queries/insert-activity.ts";
import { selectActivities } from "../queries/select-activities.ts";
import { selectActivityByClient } from "../queries/select-activity-by-client.ts";
import { selectSignals } from "../queries/select-signals.ts";
import { upsertSignal } from "../queries/upsert-signal.ts";
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
};
const activityFields = {
  id: zod.number(),
  started_at: zod.string(),
  duration_minutes: zod.number().int().positive(),
  kind: text,
  calories: zod.number().nonnegative().nullable(),
  source: text,
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
const logActivity = defineOperation({
  ...base,
  name: "log_activity",
  method: "POST",
  path: "/api/activities",
  input: zod.strictObject({
    started_at: zod.string(),
    duration_minutes: zod.number().int().positive(),
    kind: text,
    calories: zod.number().nonnegative().nullable().optional(),
    client_id: text.optional(),
  }),
  output: zod.strictObject({
    ...activityFields,
    user_id: zod.number(),
    client_id: zod.string().nullable(),
    day: zod.iso.date(),
    source_record_id: zod.string().nullable(),
    created_at: zod.string(),
  }),
  handler(input, context) {
    const person = operationPerson(context);
    const body = writeTransaction(context.database, () => {
      const owner = { user_id: person.id, client_id: input.client_id ?? null };
      const existing = () =>
        input.client_id === undefined
          ? null
          : selectActivityByClient(context.database, {
              user_id: person.id,
              client_id: input.client_id,
            });
      const replay = existing();
      if (replay) return replay;
      const started_at = canonicalInstant(input.started_at);
      const inserted = insertActivity(context.database, {
        ...input,
        ...owner,
        started_at,
        day: localDay(started_at, person.timezone, person.day_start_hour),
        calories: input.calories ?? null,
        source: context.credential === "service" ? "agent" : "manual",
        created_at: context.clock.now().toISOString(),
      });
      const stored = inserted ?? existing();
      if (!stored) throw new Error("Activity insert returned no row");
      return stored;
    });
    return { status: 200, body };
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
    activities: zod.array(zod.strictObject(activityFields)),
  }),
  handler(input, context) {
    const owner = { user_id: operationPerson(context).id, day: input.day };
    return {
      status: 200,
      body: {
        day: input.day,
        signals: selectSignals(context.database, owner).map(withUnit),
        activities: selectActivities(context.database, owner),
      },
    };
  },
});
export const signalOperations = [logSignal, logActivity, readSignals];
