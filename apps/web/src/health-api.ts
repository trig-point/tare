import { z } from "zod";
import { api } from "./api.ts";
import { displayNumber } from "./today-api.ts";

const metrics = [
  "hrv",
  "readiness",
  "resting_heart_rate",
  "sleep",
  "sleep_score",
  "steps",
  "active_calories",
  "stress",
  "stress_high",
  "recovery_high",
  "stress_summary",
] as const;
export const metricLabels: Record<(typeof metrics)[number], string> = {
  steps: "Steps",
  active_calories: "Active calories",
  sleep: "Sleep",
  resting_heart_rate: "Resting heart rate",
  hrv: "HRV",
  readiness: "Readiness",
  stress: "Stress",
  sleep_score: "Sleep score",
  stress_high: "High stress",
  recovery_high: "High recovery",
  stress_summary: "Stress summary",
};
const unitSuffix: Record<string, string> = {
  kcal: " kcal",
  minutes: " min",
  bpm: " bpm",
  ms: " ms",
};
export const signalsSchema = z.object({
  day: z.string(),
  signals: z.array(
    z
      .object({
        metric: z.enum(metrics),
        value: z.number(),
        source: z.string(),
        unit: z.string(),
        label: z.string().min(1).optional(),
        why: z.array(z.string()),
      })
      .refine(
        (entry) => entry.metric !== "stress_summary" || entry.label,
        "stress_summary needs a label",
      ),
  ),
  activities: z.array(
    z.object({
      id: z.number(),
      timing: z.enum(["exact", "date_only"]),
      started_at: z.string().nullable(),
      day: z.string(),
      duration_minutes: z.number().nullable(),
      kind: z.string(),
      category: z.enum(["strength", "cardio", "sauna", "cold_plunge", "other"]),
      calories: z.number().nullable(),
      notes: z.string().nullable(),
      source: z.string(),
      tracker: z.object({ id: z.number(), source: z.string() }).nullable(),
      sets: z.array(
        z.object({
          set_index: z.number(),
          exercise: z.string(),
          set_type: z.string(),
          reps: z.number().nullable(),
          load: z.number().nullable(),
          load_unit: z.string().nullable(),
          load_kg: z.number().nullable(),
          duration_seconds: z.number().nullable(),
          rir_low: z.number().nullable(),
          rir_high: z.number().nullable(),
          notes: z.string().nullable(),
        }),
      ),
    }),
  ),
  habits: z.array(
    z.object({
      habit_key: z.string(),
      amount: z.number().nullable(),
      note: z.string().nullable(),
      source: z.string(),
      updated_at: z.string(),
    }),
  ),
});
export type Signals = z.infer<typeof signalsSchema>;
export type Workout = Signals["activities"][number];
export type Habit = Signals["habits"][number];
export const habitLabels: Record<string, string> = {
  evening_alcohol: "Evening alcohol",
  late_caffeine: "Late caffeine",
};
export const loggedSource = (source: string) =>
  source === "manual" || source === "agent";
export const signalsKey = (person: number, day: string) =>
  ["signals", person, day] as const;
export async function readSignals(day: string, signal: AbortSignal) {
  return signalsSchema.parse(
    await api(`/api/signals/${encodeURIComponent(day)}`, { signal }),
  );
}
const send = (path: string, method: string, body?: unknown) =>
  api(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const stored = z.object({ id: z.number() });
export async function logActivity(body: Record<string, unknown>) {
  return stored.parse(await send("/api/activities", "POST", body));
}
export async function replaceSets(id: number, sets: SetInput[]) {
  return stored.parse(
    await send(`/api/activities/${id}/sets`, "PATCH", { sets }),
  );
}
export async function deleteActivity(id: number) {
  return stored.parse(await send(`/api/activities/${id}`, "DELETE"));
}
export async function logHabit(body: {
  habit_key: string;
  day: string;
  amount?: number;
}) {
  return z
    .object({ habit_key: z.string() })
    .parse(await send("/api/habits", "POST", body));
}
export async function deleteHabit(day: string, habitKey: string) {
  return z
    .object({ deleted: z.literal(true) })
    .parse(
      await send(
        `/api/habits/${encodeURIComponent(day)}/${encodeURIComponent(habitKey)}`,
        "DELETE",
      ),
    );
}
// The id changes only after a success, so a retried entry replays instead of storing twice.
export function withClientId<Body, Result>(
  post: (body: Body & { client_id: string }) => Promise<Result>,
  newId: () => string = () => crypto.randomUUID(),
) {
  let clientId = newId();
  return async (body: Body) => {
    const result = await post({ ...body, client_id: clientId });
    clientId = newId();
    return result;
  };
}

type StoredSet = Workout["sets"][number];
export type SetRow = {
  exercise: string;
  reps: string;
  load: string;
  load_unit: "kg" | "lb";
  kept: Partial<StoredSet>;
};
export type SetInput = ReturnType<typeof setInput>;
export const blankSet = (): SetRow => ({
  ...{ exercise: "", reps: "", load: "" },
  ...{ load_unit: "kg", kept: {} },
});
export function setRow(set: StoredSet): SetRow {
  const { set_type, duration_seconds, rir_low, rir_high, notes } = set;
  return {
    exercise: set.exercise,
    reps: set.reps === null ? "" : String(set.reps),
    load: set.load === null ? "" : String(set.load),
    load_unit: set.load_unit === "lb" ? "lb" : "kg",
    kept: { set_type, duration_seconds, rir_low, rir_high, notes },
  };
}
const numberOrNull = (text: string) =>
  text.trim() === "" ? null : Number(text);
export function setInput(row: SetRow) {
  const load = numberOrNull(row.load);
  return {
    ...row.kept,
    exercise: row.exercise.trim(),
    reps: numberOrNull(row.reps),
    load,
    load_unit: load === null ? null : row.load_unit,
  };
}
export function setText(set: StoredSet) {
  const reps = set.reps === null ? "" : ` ${set.reps}`;
  const load =
    set.load === null ? "" : ` × ${displayNumber(set.load)} ${set.load_unit}`;
  return `${set.exercise}${reps}${load}`;
}

const sourcePreference = ["manual", "oura", "agent"];
const sourceLabels: Record<string, string> = {
  manual: "Manual",
  oura: "Oura",
  agent: "Agent",
};
export const sourceLabel = (source: string) => sourceLabels[source] ?? source;
const rank = (source: string) => {
  const index = sourcePreference.indexOf(source);
  return index === -1 ? sourcePreference.length : index;
};
// One value per metric, never averaged: sources disagree on method, so a blend would match none of them.
// Burn keeps every source because each carries its own why-lines.
export function bodyRows(signals: Signals["signals"]) {
  const picked = new Map<string, Signals["signals"][number]>();
  for (const entry of signals) {
    const current = picked.get(entry.metric);
    if (!current || rank(entry.source) < rank(current.source))
      picked.set(entry.metric, entry);
  }
  return metrics.flatMap((metric) =>
    metric === "active_calories"
      ? signals
          .filter((entry) => entry.metric === metric)
          .sort((first, second) => rank(first.source) - rank(second.source))
      : (picked.get(metric) ?? []),
  );
}
export function signalText(entry: {
  value: number;
  unit: string;
  label?: string | undefined;
}) {
  if (entry.label)
    return entry.label.charAt(0).toUpperCase() + entry.label.slice(1);
  const value =
    entry.unit === "minutes" ? Math.round(entry.value) : entry.value;
  return `${displayNumber(value)}${unitSuffix[entry.unit] ?? ""}`;
}

export const ouraSchema = z.object({
  configured: z.boolean(),
  status: z
    .enum(["connected", "reconnect_required", "membership_required"])
    .nullable(),
  credentials: z.enum(["readable", "unreadable"]).nullable(),
  last_synced_at: z.string().nullable(),
});
export type OuraConnection = z.infer<typeof ouraSchema>;
export const ouraKey = (person: number) => ["oura", person] as const;
export async function readOura(signal: AbortSignal) {
  return ouraSchema.parse(await api("/api/oura", { signal }));
}
export async function connectOura(navigate: (url: string) => void) {
  const { authorization_url } = z
    .object({ authorization_url: z.url() })
    .parse(await api("/api/oura/connect", { method: "POST", body: "{}" }));
  navigate(authorization_url);
}

// Back from Oura can restore this page from the back-forward cache with the connect request still pending.
export function onPageRestored(target: EventTarget, restored: () => void) {
  const listener = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) restored();
  };
  target.addEventListener("pageshow", listener);
  return () => target.removeEventListener("pageshow", listener);
}

export type OuraView =
  | { state: "hidden" }
  | { state: "disconnected" }
  | { state: "restored" }
  | { state: "authorization" }
  | { state: "membership" }
  | { state: "connected"; lastSynced: string | null };
export const canConnectOura = (view: OuraView) =>
  view.state === "disconnected" ||
  view.state === "authorization" ||
  view.state === "restored";
// Unreadable tokens win over the stored status: whatever it says, they cannot be used.
export function ouraView(connection: OuraConnection): OuraView {
  if (!connection.configured) return { state: "hidden" };
  if (connection.status === null) return { state: "disconnected" };
  if (connection.credentials === "unreadable") return { state: "restored" };
  if (connection.status === "reconnect_required")
    return { state: "authorization" };
  if (connection.status === "membership_required")
    return { state: "membership" };
  return { state: "connected", lastSynced: connection.last_synced_at };
}
