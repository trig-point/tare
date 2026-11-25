import { z } from "zod";
import { api } from "./api.ts";
import {
  blankSet,
  logActivity,
  replaceSets,
  type SavedWorkout,
  type SetInput,
  setInput,
  setRow,
} from "./health-api.ts";

export const SHORT_CARD_SESSIONS = 3;
export const DEFAULT_REST_SECONDS = 90;
export const MAX_GUIDE_SETS = 56;

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
  const load = /^(\d+(?:\.\d+)?)\s*(kg|lb)?$/i.exec(
    movement.load?.trim() ?? "",
  );
  return {
    ...blankSet(),
    exercise:
      movement.name.length <= 80
        ? movement.name
        : `${movement.name
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

export type SetChange = { slot: string; set: SetInput | null };
export const guideSlot = (movement: number, set: number) =>
  `Guide set ${movement + 1}:${set + 1}`;

export async function saveGuideSet(
  workout: ScheduledWorkout,
  activity: SavedWorkout | null,
  change: SetChange,
  post = logActivity,
  patch = replaceSets,
): Promise<SavedWorkout> {
  const changed = change.set && { ...change.set, notes: change.slot };
  if (!activity) {
    if (!changed) throw new Error("No workout to update");
    activity = await post({
      timing: "date_only",
      day: workout.day,
      kind: workout.kind,
      notes: workout.name,
      client_id: guideClientId(workout),
      sets: [changed],
    });
    if (activity.sets.some((set) => set.notes === change.slot)) return activity;
  }
  const kept = activity.sets
    .filter((set) => set.notes !== change.slot)
    .map((set) => setInput(setRow(set)));
  return patch(activity.id, changed ? [...kept, changed] : kept);
}
