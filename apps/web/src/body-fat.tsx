import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Legend, Series } from "uplot";
import { bodyFatChart, bodyFatKey, readBodyFat } from "./body-fat-api.ts";
import { Plot, themeColor } from "./profile.tsx";

const points = (label: string, color: string): Series => ({
  label,
  stroke: themeColor(color),
  paths: () => null,
  points: { show: true, size: 7, fill: themeColor(color) },
});
const bodyFatSeries: Series[] = [
  {},
  points("Reading", "--color-accent"),
  points("After a workout", "--color-caution"),
  points("Later weigh-in", "--color-ink-3"),
];
const keyOnly: Legend = { show: true, live: false };

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
            trend.status === "ready" &&
            index === trend.lines.length - 1 &&
            Math.abs(trend.change_points) < 2
              ? "This scale's error is about 2 points"
              : undefined
          }
        >
          {line}
        </p>
      ))}
      <Plot data={chart} series={bodyFatSeries} legend={keyOnly} />
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
