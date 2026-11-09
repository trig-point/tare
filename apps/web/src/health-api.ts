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
});
export type Signals = z.infer<typeof signalsSchema>;
export const signalsKey = (person: number, day: string) =>
  ["signals", person, day] as const;
export async function readSignals(day: string, signal: AbortSignal) {
  return signalsSchema.parse(
    await api(`/api/signals/${encodeURIComponent(day)}`, { signal }),
  );
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
export function bodyRows(signals: Signals["signals"]) {
  const picked = new Map<string, Signals["signals"][number]>();
  for (const entry of signals) {
    const current = picked.get(entry.metric);
    if (!current || rank(entry.source) < rank(current.source))
      picked.set(entry.metric, entry);
  }
  return metrics.flatMap((metric) => picked.get(metric) ?? []);
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
