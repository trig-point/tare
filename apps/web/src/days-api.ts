import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "./api.ts";
import { intakeSchema, todaySchema } from "./today-api.ts";

const rating = z.number().int().min(1).max(5).nullable();
const metadata = z.object({
  day: z.string(),
  signed_off_at: z.string().nullable(),
  hunger: rating,
  fullness: rating,
  notes: z.string().nullable(),
});
export const daySchema = metadata.extend({
  entries: z.array(intakeSchema),
  totals: todaySchema.shape.totals,
});
export type DayData = z.infer<typeof daySchema>;
export type DayMetadata = z.infer<typeof metadata>;
export type SignOffValues = {
  hunger: string;
  fullness: string;
  notes: string;
};

export const dayKey = (person: number, day: string) =>
  ["day", person, day] as const;
export const unsignedKey = (person: number) =>
  ["unsigned-days", person] as const;

export async function readDay(day: string, signal: AbortSignal) {
  return daySchema.parse(
    await api(`/api/days/${encodeURIComponent(day)}`, { signal }),
  );
}

export async function readUnsignedDays(signal: AbortSignal) {
  return z
    .object({ days: z.array(metadata) })
    .parse(await api("/api/days/unsigned", { signal })).days;
}

export function signOffValues(day: DayMetadata): SignOffValues {
  return {
    hunger: day.hunger === null ? "" : String(day.hunger),
    fullness: day.fullness === null ? "" : String(day.fullness),
    notes: day.notes ?? "",
  };
}

export async function signOffDay(day: string, values: SignOffValues) {
  const score = (value: string) => (value === "" ? null : Number(value));
  return metadata.parse(
    await api("/api/days/sign-off", {
      method: "POST",
      body: JSON.stringify({
        day,
        hunger: score(values.hunger),
        fullness: score(values.fullness),
        notes: values.notes.trim() === "" ? null : values.notes,
      }),
    }),
  );
}

export function nextUnsignedDay(days: DayMetadata[], current: string) {
  return days.find((entry) => entry.day !== current)?.day ?? null;
}

export async function refreshDays(client: QueryClient, person: number) {
  await client.invalidateQueries({ queryKey: ["day", person] });
  await client.invalidateQueries({ queryKey: unsignedKey(person) });
}
