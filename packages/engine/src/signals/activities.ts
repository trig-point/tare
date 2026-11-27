import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import { writeTransaction } from "../db.ts";
import { canonicalInstant, localDay } from "../logging/day.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { deleteActivity as deleteSession } from "../queries/delete-activity.ts";
import { deleteActivitySet } from "../queries/delete-activity-set.ts";
import { deleteActivitySetRemoval } from "../queries/delete-activity-set-removal.ts";
import { deleteActivitySets } from "../queries/delete-activity-sets.ts";
import { insertActivity } from "../queries/insert-activity.ts";
import { insertActivitySet } from "../queries/insert-activity-set.ts";
import { recordActivitySetRemoval } from "../queries/record-activity-set-removal.ts";
import { recordActivitySetRemovals } from "../queries/record-activity-set-removals.ts";
import { selectActivities } from "../queries/select-activities.ts";
import { selectActivity } from "../queries/select-activity.ts";
import { selectActivityByClient } from "../queries/select-activity-by-client.ts";
import { selectActivitySetRemoval } from "../queries/select-activity-set-removal.ts";
import { selectActivitySets } from "../queries/select-activity-sets.ts";
import { activityCategories, countUnknownKinds } from "./activity-kinds.ts";
import {
  loggedSources,
  mergeWorkouts,
  poundsToKg,
  setView,
} from "./merged-workouts.ts";

// SQLite length() stops at NUL, so the nonblank CHECK would fail as a 500.
const text = (max: number) =>
  zod
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !value.includes("\u0000"));
const setInput = zod
  .strictObject({
    exercise: text(80),
    set_type: zod.enum(["warmup", "working", "drop", "failure"]).optional(),
    reps: zod.number().int().min(0).max(1000).nullable().optional(),
    load: zod.number().min(0).max(1000).nullable().optional(),
    load_unit: zod.enum(["kg", "lb", "pin"]).nullable().optional(),
    duration_seconds: zod.number().int().positive().max(86_400).nullish(),
    rir_low: zod.number().int().min(0).max(10).nullable().optional(),
    rir_high: zod.number().int().min(0).max(10).nullable().optional(),
    notes: text(200).nullable().optional(),
  })
  .refine(
    (set) =>
      ((set.load ?? null) === null) === ((set.load_unit ?? null) === null),
  )
  .refine(
    (set) =>
      ((set.rir_low ?? null) === null) === ((set.rir_high ?? null) === null),
  )
  .refine((set) => (set.rir_low ?? 0) <= (set.rir_high ?? 10));
const clientSetIdMaxLength = 40;
const clientSetId = text(clientSetIdMaxLength).refine((id) =>
  id.isWellFormed(),
);
const bulkSetInput = setInput.safeExtend({
  client_set_id: clientSetId.nullish(),
});
type SetInput = zod.output<typeof bulkSetInput>;
const sessionInput = {
  timing: zod.enum(["exact", "date_only"]).optional(),
  started_at: zod.string().max(40).optional(),
  duration_minutes: zod.number().int().positive().max(1440).optional(),
  day: zod.iso.date().optional(),
  kind: text(60),
  calories: zod.number().nonnegative().max(100_000).nullable().optional(),
  notes: text(1000).nullable().optional(),
  client_id: text(100).optional(),
  sets: zod.array(bulkSetInput).optional(),
};

// Widest values per field, at 3 UTF-8 bytes per UTF-16 unit, so the cap holds for any unescaped JSON text.
const wide = (units: number) => String.fromCharCode(0x800).repeat(units);
const widestNumber = 0.00012345678901234567;
export const widestSet = {
  exercise: wide(80),
  set_type: "failure",
  reps: 1000,
  load: widestNumber,
  load_unit: "kg",
  duration_seconds: 86_400,
  rir_low: 10,
  rir_high: 10,
  notes: wide(200),
  client_set_id: wide(clientSetIdMaxLength),
};
export const widestSession = {
  timing: "exact",
  started_at: "2026-01-01T00:00:00.000000000+00:00",
  duration_minutes: 1440,
  kind: wide(60),
  calories: widestNumber,
  notes: wide(1000),
  client_id: wide(100),
};
export const activityBodyLimit = 70_000;
export const setCap = 56;

const setOutput = zod.strictObject({
  set_index: zod.number(),
  exercise: zod.string(),
  set_type: zod.string(),
  reps: zod.number().nullable(),
  load: zod.number().nullable(),
  load_unit: zod.string().nullable(),
  load_kg: zod.number().nullable(),
  duration_seconds: zod.number().nullable(),
  rir_low: zod.number().nullable(),
  rir_high: zod.number().nullable(),
  notes: zod.string().nullable(),
  client_set_id: zod.string().nullable(),
});
const sessionFields = {
  id: zod.number(),
  timing: zod.enum(["exact", "date_only"]),
  started_at: zod.string().nullable(),
  day: zod.iso.date(),
  duration_minutes: zod.number().int().positive().nullable(),
  kind: zod.string(),
  calories: zod.number().nonnegative().nullable(),
  notes: zod.string().nullable(),
  source: zod.string(),
  client_id: zod.string().nullable(),
  sets: zod.array(setOutput),
};
export const workoutOutput = zod.strictObject({
  ...sessionFields,
  category: zod.enum(activityCategories),
  tracker: zod
    .strictObject({ id: zod.number(), source: zod.string() })
    .nullable(),
});
const base = {
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser_and_agent",
  admin: false,
} as const;

function sessionSets(
  database: Database,
  user_id: number,
  id: number,
  day: string,
) {
  return selectActivitySets(database, { user_id, from: day, to: day })
    .filter((row) => row.session_id === id)
    .map(setView);
}
// Tracker rows are written only by sync; a pair takes its sets from the logged session, so sets here would be hidden.
function ownedLoggedSession(
  database: Database,
  user_id: number,
  id: number,
  clientId?: string,
) {
  const session = selectActivity(database, { user_id, id });
  if (clientId !== undefined && session?.client_id !== clientId)
    throw new OperationError(409, "stale_session");
  if (!session) throw new OperationError(404, "not_found");
  if (!loggedSources.has(session.source))
    throw new OperationError(400, "tracker_session");
  return session;
}
type SetOwner = { user_id: number; session_id: number };

function insertSet(
  database: Database,
  owner: SetOwner,
  set_index: number,
  set: SetInput,
) {
  const load = set.load ?? null;
  insertActivitySet(database, {
    ...owner,
    set_index,
    exercise: set.exercise,
    set_type: set.set_type ?? "working",
    reps: set.reps ?? null,
    load_kg:
      load === null ? null : set.load_unit === "lb" ? poundsToKg(load) : load,
    load_unit: load === null ? null : (set.load_unit ?? null),
    duration_seconds: set.duration_seconds ?? null,
    rir_low: set.rir_low ?? null,
    rir_high: set.rir_high ?? null,
    notes: set.notes ?? null,
    client_set_id: set.client_set_id ?? null,
  });
}

function writeSets(database: Database, owner: SetOwner, sets: SetInput[]) {
  if (sets.length > setCap) throw new OperationError(400, "too_many_sets");
  const ids = sets.flatMap(({ client_set_id }) => client_set_id ?? []);
  if (new Set(ids).size !== ids.length)
    throw new OperationError(400, "invalid_request");
  recordActivitySetRemovals(database, owner);
  deleteActivitySets(database, owner);
  sets.forEach((set, index) => insertSet(database, owner, index + 1, set));
  for (const client_set_id of ids)
    deleteActivitySetRemoval(database, { ...owner, client_set_id });
}

export const logActivity = defineOperation({
  ...base,
  bodyLimit: activityBodyLimit,
  name: "log_activity",
  description:
    "Log a workout with optional client set IDs of up to 40 characters.",
  method: "POST",
  path: "/api/activities",
  input: zod
    .strictObject(sessionInput)
    .refine((input) =>
      input.timing === "date_only"
        ? input.day !== undefined &&
          input.started_at === undefined &&
          input.duration_minutes === undefined
        : input.day === undefined &&
          input.started_at !== undefined &&
          input.duration_minutes !== undefined,
    ),
  output: zod.strictObject({
    ...sessionFields,
    user_id: zod.number(),
    source_record_id: zod.string().nullable(),
    created_at: zod.string(),
  }),
  handler(input, context) {
    const person = operationPerson(context);
    const { sets = [], ...session } = input;
    const source = context.credential === "service" ? "agent" : "manual";
    const stored = writeTransaction(context.database, () => {
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
      const started_at =
        session.started_at === undefined
          ? null
          : canonicalInstant(session.started_at);
      const inserted = insertActivity(context.database, {
        ...owner,
        timing: session.timing ?? "exact",
        started_at,
        day:
          started_at === null
            ? (session.day ?? "")
            : localDay(started_at, person.timezone, person.day_start_hour),
        duration_minutes: session.duration_minutes ?? null,
        kind: session.kind,
        calories: session.calories ?? null,
        notes: session.notes ?? null,
        source,
        created_at: context.clock.now().toISOString(),
      });
      if (!inserted) {
        const raced = existing();
        if (!raced) throw new Error("Activity insert returned no row");
        return raced;
      }
      writeSets(
        context.database,
        { user_id: person.id, session_id: inserted.id },
        sets,
      );
      countUnknownKinds([inserted.kind], source);
      return inserted;
    });
    return {
      status: 200,
      body: {
        ...stored,
        sets: sessionSets(context.database, person.id, stored.id, stored.day),
      },
    };
  },
});
const replaceActivitySets = defineOperation({
  ...base,
  bodyLimit: activityBodyLimit,
  name: "replace_activity_sets",
  description:
    "Replace a workout's sets and keep any supplied client set IDs of up to 40 characters.",
  method: "PATCH",
  path: "/api/activities/:id/sets",
  input: zod.strictObject({
    id: zod.coerce.number().int().positive(),
    sets: zod.array(bulkSetInput),
  }),
  output: zod.strictObject({ id: zod.number(), sets: zod.array(setOutput) }),
  handler(input, context) {
    const person = operationPerson(context);
    const day = writeTransaction(context.database, () => {
      const session = ownedLoggedSession(context.database, person.id, input.id);
      writeSets(
        context.database,
        { user_id: person.id, session_id: session.id },
        input.sets,
      );
      return session.day;
    });
    return {
      status: 200,
      body: {
        id: input.id,
        sets: sessionSets(context.database, person.id, input.id, day),
      },
    };
  },
});

const setIdentity = {
  session_id: zod.number().int().positive(),
  session_client_id: text(100),
  client_set_id: clientSetId,
};

const addActivitySet = defineOperation({
  ...base,
  bodyLimit: activityBodyLimit,
  name: "add_activity_set",
  description:
    "Use a fresh random client_set_id of up to 40 characters for each Done and reuse it only for its retries and Undo (removed: true with set: null means nothing was saved). Send one session write at a time from one tab and close and clear the workout on stale_session without retrying.",
  method: "POST",
  path: "/api/activity-sets",
  input: zod.strictObject({ ...setIdentity, set: setInput }),
  output: zod
    .strictObject({
      set: setOutput.nullable(),
      repeat: zod.boolean().optional(),
      removed: zod.literal(true).optional(),
      sets: zod.array(setOutput),
    })
    .refine(({ set, repeat, removed }) =>
      set === null
        ? removed === true && repeat === undefined
        : removed === undefined && repeat !== undefined,
    ),
  handler(input, context) {
    const { database } = context;
    const user_id = operationPerson(context).id;
    const { session_id, session_client_id, client_set_id } = input;
    const owner = { user_id, session_id };
    return writeTransaction(database, () => {
      const session = ownedLoggedSession(
        database,
        user_id,
        session_id,
        session_client_id,
      );
      const removed = selectActivitySetRemoval(database, {
        ...owner,
        client_set_id,
      });
      const sets = sessionSets(database, user_id, session_id, session.day);
      if (removed)
        return { status: 200, body: { set: null, removed: true, sets } };
      const existing = sets.find((set) => set.client_set_id === client_set_id);
      if (existing)
        return { status: 200, body: { set: existing, repeat: true, sets } };
      if (sets.length >= setCap) throw new OperationError(400, "too_many_sets");
      const setIndex = (sets.at(-1)?.set_index ?? 0) + 1;
      insertSet(database, owner, setIndex, { ...input.set, client_set_id });
      const updated = sessionSets(database, user_id, session_id, session.day);
      const set = updated.at(-1);
      if (set?.client_set_id !== client_set_id)
        throw new Error("Activity set insert returned no row");
      return { status: 200, body: { set, repeat: false, sets: updated } };
    });
  },
});

const removeActivitySet = defineOperation({
  ...base,
  bodyLimit: activityBodyLimit,
  name: "remove_activity_set",
  description:
    "Undo a set by sending its original client_set_id of up to 40 characters, then use a fresh ID for the next Done. Send one session write at a time from one tab and close and clear the workout on stale_session without retrying.",
  method: "POST",
  path: "/api/activity-sets/remove",
  input: zod.strictObject(setIdentity),
  output: zod.strictObject({ removed: zod.boolean() }),
  handler(input, context) {
    const { database } = context;
    const user_id = operationPerson(context).id;
    const { session_id, session_client_id, client_set_id } = input;
    const identity = { user_id, session_id, client_set_id };
    const removed = writeTransaction(database, () => {
      ownedLoggedSession(database, user_id, session_id, session_client_id);
      const { changes } = deleteActivitySet(database, identity);
      recordActivitySetRemoval(database, identity);
      return changes > 0;
    });
    return { status: 200, body: { removed } };
  },
});

function deleteLoggedSession(database: Database, user_id: number, id: number) {
  deleteActivitySets(database, { user_id, session_id: id });
  deleteSession(database, { user_id, id });
}

const discardActivity = defineOperation({
  ...base,
  bodyLimit: activityBodyLimit,
  name: "discard_activity",
  description:
    "Discard a logged workout by its session ID and original client ID, sending one session write at a time from one tab. On discarded: false, close and clear the workout without retrying.",
  method: "POST",
  path: "/api/activities/discard",
  input: zod.strictObject({
    id: zod.number().int().positive(),
    client_id: text(100),
  }),
  output: zod.strictObject({ discarded: zod.boolean() }),
  handler(input, context) {
    const { database } = context;
    const user_id = operationPerson(context).id;
    const discarded = writeTransaction(database, () => {
      const session = selectActivity(database, { user_id, id: input.id });
      if (
        session?.client_id !== input.client_id ||
        !loggedSources.has(session.source)
      )
        return false;
      deleteLoggedSession(database, user_id, input.id);
      return true;
    });
    return { status: 200, body: { discarded } };
  },
});

const deleteActivity = defineOperation({
  ...base,
  name: "delete_activity",
  description: "Remove a logged session and its sets. Tracker sessions stay.",
  method: "DELETE",
  path: "/api/activities/:id",
  input: zod.strictObject({ id: zod.coerce.number().int().positive() }),
  output: zod.strictObject({ deleted: zod.literal(true), id: zod.number() }),
  handler(input, context) {
    const user_id = operationPerson(context).id;
    writeTransaction(context.database, () => {
      ownedLoggedSession(context.database, user_id, input.id);
      deleteLoggedSession(context.database, user_id, input.id);
    });
    return { status: 200, body: { deleted: true, id: input.id } };
  },
});

const maxRangeDays = 120;
export function readWorkouts(
  database: Database,
  range: { user_id: number; from: string; to: string },
) {
  return mergeWorkouts(
    selectActivities(database, range),
    selectActivitySets(database, range),
  );
}
const readActivities = defineOperation({
  ...base,
  name: "read_activities",
  method: "GET",
  path: "/api/activities/:from/:to",
  input: zod
    .strictObject({ from: zod.iso.date(), to: zod.iso.date() })
    .refine(
      (range) =>
        range.from <= range.to &&
        Date.parse(range.to) - Date.parse(range.from) <
          maxRangeDays * 86_400_000,
    ),
  output: zod.strictObject({
    from: zod.iso.date(),
    to: zod.iso.date(),
    workouts: zod.array(workoutOutput),
  }),
  handler(input, context) {
    const user_id = operationPerson(context).id;
    return {
      status: 200,
      body: {
        ...input,
        workouts: readWorkouts(context.database, { user_id, ...input }),
      },
    };
  },
});
export const activityOperations = [
  replaceActivitySets,
  addActivitySet,
  removeActivitySet,
  discardActivity,
  deleteActivity,
  readActivities,
];
