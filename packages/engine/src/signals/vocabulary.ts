import { stressSummaries } from "@tare/health-sources";
import { z as zod } from "zod";

const score = zod.number().min(0).max(100);
const minutes = zod.number().min(0).max(1440);
export const signalVocabulary = {
  steps: { unit: "count", value: zod.number().int().nonnegative() },
  active_calories: { unit: "kcal", value: zod.number().nonnegative() },
  sleep: { unit: "minutes", value: minutes },
  sleep_score: { unit: "score", value: score },
  resting_heart_rate: { unit: "bpm", value: zod.number().positive() },
  hrv: { unit: "ms", value: zod.number().positive() },
  readiness: { unit: "score", value: score },
  stress: { unit: "score", value: score },
  stress_high: { unit: "minutes", value: minutes },
  recovery_high: { unit: "minutes", value: minutes },
  stress_summary: {
    unit: "category",
    value: zod.number().int().min(0).max(2),
    labels: stressSummaries,
  },
} as const;
type Metric = keyof typeof signalVocabulary;
export const metricName = zod.enum(
  Object.keys(signalVocabulary) as [Metric, ...Metric[]],
);
// Categorical metrics store a code; readers get the label so they never see a bare number.
export function withUnit<Row extends { metric: string; value: number }>(
  row: Row,
) {
  const metric = metricName.parse(row.metric);
  const entry: { unit: string; labels?: readonly string[] } =
    signalVocabulary[metric];
  const label = entry.labels?.[row.value];
  return { ...row, metric, unit: entry.unit, ...(label ? { label } : {}) };
}
