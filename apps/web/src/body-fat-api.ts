import type { AlignedData } from "uplot";
import { z } from "zod";
import { api } from "./api.ts";

const readingSchema = z.object({
  id: z.number(),
  day: z.string(),
  measured_at: z.string(),
  body_fat_pct: z.number(),
  after_workout: z.boolean(),
  in_trend: z.boolean(),
});
export const bodyFatSchema = z.object({
  readings: z.array(readingSchema),
  trend: z
    .discriminatedUnion("status", [
      z.object({ status: z.literal("not_enough"), message: z.string() }),
      z.object({
        status: z.literal("ready"),
        level_pct: z.number(),
        message: z.string(),
        line: z.string(),
      }),
    ])
    .nullable(),
});
export type BodyFat = z.infer<typeof bodyFatSchema>;
// Under the today key so a weigh-in or workout refresh also refreshes this card.
export const bodyFatKey = (person: number) =>
  ["today", person, "body-fat"] as const;
export async function readBodyFat(signal: AbortSignal) {
  return bodyFatSchema.parse(await api("/api/body-fat/history", { signal }));
}
export function bodyFatChart(bodyFat: BodyFat): AlignedData {
  const pick = (keep: (reading: BodyFat["readings"][number]) => boolean) =>
    bodyFat.readings.map((reading) =>
      keep(reading) ? reading.body_fat_pct : null,
    );
  return [
    bodyFat.readings.map((reading) => Date.parse(reading.measured_at) / 1000),
    pick((reading) => reading.in_trend),
    pick((reading) => reading.after_workout),
    pick((reading) => !reading.in_trend && !reading.after_workout),
  ];
}
