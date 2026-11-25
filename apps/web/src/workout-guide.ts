import { z } from "zod";
import { ApiError, api } from "./api.ts";
import { activitySetSchema, blankSet, type SetInput } from "./health-api.ts";

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
  movements: z.array(movement),
});
export type ScheduledWorkout = z.infer<typeof today>;
export type PlannedMovement = z.infer<typeof movement>;

export async function readScheduledWorkout(signal: AbortSignal) {
  return z
    .object({ today: today.nullable() })
    .parse(await api("/api/workout-schedule/today", { signal })).today;
}

export function opensShort(movement: PlannedMovement) {
  return (movement.card?.sessions ?? 0) >= SHORT_CARD_SESSIONS;
}

export function prescribedSet(movement: PlannedMovement) {
  const name = movement.name.trim();
  const load = /^(\d+(?:\.\d+)?)\s*(kg|lb)?$/i.exec(
    movement.load?.trim() ?? "",
  );
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
    load: load?.[1] ?? "",
    load_unit:
      load?.[2]?.toLowerCase() === "lb" ? ("lb" as const) : ("kg" as const),
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

export function newGuideSet(set: SetInput, mint = () => crypto.randomUUID()) {
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
