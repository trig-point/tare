import { z } from "zod";
import { api } from "./api.ts";
import { blankSet, logActivity, setInput } from "./health-api.ts";

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

const markedSet = z
  .object({
    exercise: z.string().min(1).max(80),
    reps: z.number().int().min(0).max(1000).nullable(),
    load: z.number().min(0).max(1000).nullable(),
    load_unit: z.enum(["kg", "lb"]).nullable(),
  })
  .refine((set) => (set.load === null) === (set.load_unit === null));

const draftSchema = z.object({
  clientId: z.uuid(),
  marks: z.record(z.string(), markedSet),
  rest: z.object({ set: z.string(), end: z.number().nonnegative() }).nullable(),
});
export type GuideDraft = z.infer<typeof draftSchema>;
export const newGuideDraft = (): GuideDraft => ({
  clientId: crypto.randomUUID(),
  marks: {},
  rest: null,
});

export function readGuideDraft(storageKey: string): GuideDraft {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) return draftSchema.parse(JSON.parse(stored));
  } catch {
    return newGuideDraft();
  }
  return newGuideDraft();
}

export function writeGuideDraft(storageKey: string, draft: GuideDraft | null) {
  try {
    if (draft === null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, JSON.stringify(draft));
  } catch {
    return;
  }
}

export function prescribedSet(movement: PlannedMovement) {
  const load = /^(\d+(?:\.\d+)?)\s*(kg|lb)?$/i.exec(
    movement.load?.trim() ?? "",
  );
  return {
    ...blankSet(),
    exercise: movement.name,
    reps: /^\d+$/.test(movement.reps.trim()) ? movement.reps.trim() : "",
    load: load?.[1] ?? "",
    load_unit:
      load?.[2]?.toLowerCase() === "lb" ? ("lb" as const) : ("kg" as const),
  };
}

export function markSet(
  draft: GuideDraft,
  set: string,
  row: ReturnType<typeof prescribedSet>,
  movement: PlannedMovement,
  clock: () => number,
) {
  const marked = markedSet.parse(setInput(row));
  return {
    ...draft,
    marks: { ...draft.marks, [set]: marked },
    rest: {
      set,
      end:
        clock() + (movement.card?.rest_seconds ?? DEFAULT_REST_SECONDS) * 1000,
    },
  };
}

export function restSeconds(end: number, clock: () => number) {
  return Math.max(0, Math.ceil((end - clock()) / 1000));
}

export function finishGuide(
  workout: ScheduledWorkout,
  draft: GuideDraft,
  post = logActivity,
) {
  const sets = Object.entries(draft.marks)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, set]) => set);
  return post({
    timing: "date_only",
    day: workout.day,
    kind: workout.kind,
    notes: workout.name,
    client_id: draft.clientId,
    sets,
  });
}
