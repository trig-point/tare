import { z as zod } from "zod";

export const signalVocabulary = {
  steps: { unit: "count", value: zod.number().int().nonnegative() },
  active_calories: { unit: "kcal", value: zod.number().nonnegative() },
  sleep: { unit: "minutes", value: zod.number().min(0).max(1440) },
  resting_heart_rate: { unit: "bpm", value: zod.number().positive() },
  hrv: { unit: "ms", value: zod.number().positive() },
  readiness: { unit: "score", value: zod.number().min(0).max(100) },
  stress: { unit: "score", value: zod.number().min(0).max(100) },
} as const;
type Metric = keyof typeof signalVocabulary;
export const metricName = zod.enum(
  Object.keys(signalVocabulary) as [Metric, ...Metric[]],
);
export function withUnit<Row extends { metric: string }>(row: Row) {
  const metric = metricName.parse(row.metric);
  return { ...row, metric, unit: signalVocabulary[metric].unit };
}
