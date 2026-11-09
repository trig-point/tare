import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Series } from "uplot";
import { bodyFatChart, bodyFatKey, readBodyFat } from "./body-fat-api.ts";
import { Plot } from "./profile.tsx";

const points = (label: string, color: string): Series => ({
  label,
  stroke: color,
  paths: () => null,
  points: { show: true, size: 7, fill: color },
});
const bodyFatSeries: Series[] = [
  {},
  points("Reading", "#234b40"),
  points("After a workout", "#b5651d"),
  points("Later reading", "#b8bcb4"),
];

export function BodyFatCard({
  person,
  online,
}: {
  person: number;
  online: boolean;
}) {
  const bodyFat = useQuery({
    queryKey: bodyFatKey(person),
    queryFn: ({ signal }) => readBodyFat(signal),
    enabled: online,
  });
  const data = bodyFat.data;
  const chart = useMemo(() => data && bodyFatChart(data), [data]);
  if (bodyFat.isError) return <p role="alert">Couldn’t load body fat</p>;
  if (!data || !chart || data.readings.length === 0) return null;
  const { trend } = data;
  return (
    <section aria-label="Body fat">
      <h2>Body fat</h2>
      {trend?.status === "ready" && (
        <p>
          <strong>{trend.level_pct}%</strong>
        </p>
      )}
      {trend?.lines.map((line, index) => (
        <p
          key={line}
          title={
            trend.status === "ready" && index === trend.lines.length - 1
              ? "This scale's error is about 2 points"
              : undefined
          }
        >
          {line}
        </p>
      ))}
      <Plot data={chart} series={bodyFatSeries} />
      <details>
        <summary>Readings</summary>
        <ul className="entries">
          {data.readings.toReversed().map((reading) => (
            <li key={reading.id}>
              <strong>{reading.body_fat_pct}%</strong>{" "}
              <span>{reading.day}</span>
              {reading.after_workout && <span> After a workout</span>}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
