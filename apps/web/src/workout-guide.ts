import { z } from "zod";
import { ApiError, api } from "./api.ts";
import {
  activitySetSchema,
  blankSet,
  type LoadUnit,
  loadUnit,
  type SetInput,
  type SetRow,
  setRow,
} from "./health-api.ts";

import { clientId as newClientId } from "./outbox-store.ts";

export const SHORT_CARD_SESSIONS = 3;
export const DEFAULT_REST_SECONDS = 90;

const card = z.object({
  equipment: z.string().nullable(),
  rest_seconds: z.number().int().min(0).max(3600).nullable(),
  sessions: z.number().int().nonnegative(),
  setup: z.array(z.string()),
  cues: z.array(z.string()),
  mistakes: z.array(z.string()),
  safety: z.array(z.string()),
  pictures: z.array(z.url({ protocol: /^https?$/ })),
});
const movement = z.object({
  name: z.string(),
  sets: z.number().int().min(1).max(20),
  reps: z.string(),
  load: z.string().optional(),
  card: card.nullable(),
});
const today = z.object({
  day: z.iso.date(),
  kind: z.enum(["lift", "cardio", "rest"]),
  name: z.string(),
  session: z.string().nullable(),
  where: z.string().nullable(),
  alternates: z.array(
    z.object({ key: z.string(), name: z.string(), where: z.string() }),
  ),
  movements: z.array(movement),
});
export type ScheduledWorkout = z.infer<typeof today>;
export type PlannedMovement = z.infer<typeof movement>;

export async function readScheduledWorkout(
  signal?: AbortSignal,
  session?: string,
) {
  const path = session
    ? `/api/workout-schedule/today/${encodeURIComponent(session)}`
    : "/api/workout-schedule/today";
  return z
    .object({ today: today.nullable() })
    .parse(await api(path, { signal })).today;
}

export function guideChoices(workout: ScheduledWorkout) {
  if (!workout.session || !workout.alternates.length) return [];
  return [
    { key: workout.session, where: workout.where ?? workout.name },
    ...workout.alternates.map(({ key, where }) => ({ key, where })),
  ];
}

export async function openGuideChoice(workout: ScheduledWorkout, key: string) {
  if (key === workout.session) return workout;
  const chosen = await readScheduledWorkout(undefined, key);
  if (chosen?.day !== workout.day) throw new Error("Workout day changed");
  return chosen;
}

export function opensShort(movement: PlannedMovement) {
  return (movement.card?.sessions ?? 0) >= SHORT_CARD_SESSIONS;
}

const plannedLoad =
  /^(?:(pin)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:(kg|lb)\s*(?:per\s+hand|\/\s*hand|each)?|(pin))?)$/i;

function readLoad(text: string | undefined) {
  const match = plannedLoad.exec(text?.trim() ?? "");
  const load = match?.[2] ?? match?.[3];
  return load ? { load, unit: match?.[1] ?? match?.[4] ?? match?.[5] } : null;
}

export function sessionLoadUnit(workout: ScheduledWorkout): LoadUnit {
  const units = workout.movements.map((movement) =>
    readLoad(movement.load)?.unit?.toLowerCase(),
  );
  const count = (unit: LoadUnit) =>
    units.filter((read) => read === unit).length;
  return count("lb") > count("kg") ? "lb" : "kg";
}

export function prescribedSet(
  movement: PlannedMovement,
  fallbackUnit: LoadUnit = "kg",
) {
  const name = movement.name.trim();
  const load = readLoad(movement.load);
  return {
    ...blankSet(),
    exercise:
      name.length <= 80
        ? name
        : `${name
            .slice(0, 79)
            .replace(/[\uD800-\uDBFF]$/, "")
            .trimEnd()}…`,
    reps: /^\d+$/.test(movement.reps.trim()) ? movement.reps.trim() : "",
    load: load?.load ?? "",
    load_unit: load?.unit ? loadUnit(load.unit) : fallbackUnit,
  };
}

export function followSet(
  base: SetRow,
  previous: SavedWorkout["sets"][number] | undefined,
  setNumber: number,
) {
  if (setNumber === 1 || !previous) return base;
  const prior = setRow(previous);
  return {
    ...base,
    reps: prior.reps,
    load: prior.load,
    load_unit: previous.load_unit === null ? base.load_unit : prior.load_unit,
  };
}

export function restSeconds(end: number, clock: () => number) {
  return Math.max(0, Math.ceil((end - clock()) / 1000));
}

export function guideClientId(workout: ScheduledWorkout) {
  return `guide:${workout.day}:${workout.session ?? workout.name}`;
}

export function restEnd(movement: PlannedMovement, clock: () => number) {
  return clock() + (movement.card?.rest_seconds ?? DEFAULT_REST_SECONDS) * 1000;
}

const setsSchema = z.array(activitySetSchema);
const activitySchema = z.object({
  id: z.number(),
  client_id: z.string().nullable(),
  sets: setsSchema,
});
export type SavedWorkout = z.infer<typeof activitySchema>;

export async function readGuideActivity(
  workout: ScheduledWorkout,
  signal?: AbortSignal,
) {
  const day = encodeURIComponent(workout.day);
  const result = z
    .object({ workouts: z.array(activitySchema) })
    .parse(await api(`/api/activities/${day}/${day}`, { signal }));
  return (
    result.workouts.find(
      (activity) => activity.client_id === guideClientId(workout),
    ) ?? null
  );
}

const post = (path: string, body: unknown) =>
  api(path, { method: "POST", body: JSON.stringify(body) });

export function newGuideSet(
  set: SetInput,
  mint = () => newClientId(globalThis.crypto),
) {
  return { set, id: mint() };
}

export async function saveGuideSet(
  workout: ScheduledWorkout,
  activity: SavedWorkout | null,
  change: ReturnType<typeof newGuideSet>,
) {
  const clientId = guideClientId(workout);
  if (!activity) {
    activity = activitySchema.parse(
      await post("/api/activities", {
        timing: "date_only",
        day: workout.day,
        kind: workout.kind,
        notes: workout.name,
        client_id: clientId,
        sets: [{ ...change.set, client_set_id: change.id }],
      }),
    );
    if (activity.sets.some((set) => set.client_set_id === change.id))
      return { activity, saved: true };
  }
  const { sets, set } = z
    .object({
      sets: setsSchema,
      set: activitySetSchema.nullable(),
      removed: z.literal(true).optional(),
    })
    .refine(({ set, removed }) => (set === null) === (removed === true))
    .parse(
      await post("/api/activity-sets", {
        session_id: activity.id,
        session_client_id: clientId,
        client_set_id: change.id,
        set: change.set,
      }),
    );
  return { activity: { ...activity, sets }, saved: set !== null };
}

export async function undoGuideSet(
  workout: ScheduledWorkout,
  activity: SavedWorkout,
  id: string,
) {
  z.object({ removed: z.boolean() }).parse(
    await post("/api/activity-sets/remove", {
      session_id: activity.id,
      session_client_id: guideClientId(workout),
      client_set_id: id,
    }),
  );
  const current = await readGuideActivity(workout);
  if (current?.id !== activity.id) throw new ApiError(409, "stale_session");
  return current;
}

export async function discardGuide(
  workout: ScheduledWorkout,
  activity: SavedWorkout,
) {
  return z.object({ discarded: z.boolean() }).parse(
    await post("/api/activities/discard", {
      id: activity.id,
      client_id: guideClientId(workout),
    }),
  );
}

export function closeStaleGuide(error: unknown, close: () => void) {
  if (
    !(
      error instanceof ApiError &&
      error.status === 409 &&
      error.code === "stale_session"
    )
  )
    return false;
  close();
  return true;
}

export function pendingGuideAction<
  Action extends
    | { kind: "done"; change: { id: string } }
    | { kind: "undo"; id: string },
>(
  action: Action | null,
  activity: SavedWorkout | null | undefined,
): Action | null {
  if (!action || activity === undefined) return action;
  const id = action.kind === "done" ? action.change.id : action.id;
  const present =
    activity?.sets.some((set) => set.client_set_id === id) ?? false;
  return present === (action.kind === "done") ? null : action;
}
