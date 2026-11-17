import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Legend, Series } from "uplot";
import {
  type BodyFat,
  bodyFatChart,
  bodyFatKey,
  readBodyFat,
} from "./body-fat-api.ts";
import {
  Metric,
  Plot,
  Skeleton,
  sectionHead,
  shortDate,
  themeColor,
} from "./profile.tsx";
import { cn } from "./shared/ui/index.ts";
import { Disclosure } from "./slots.tsx";

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
const hint = "m-0 text-sm text-ink-2";

/** An after-workout reading gets the workout label, as on the chart, even when it is in the trend. */
function readingKind(reading: BodyFat["readings"][number]) {
  if (reading.after_workout) return "After a workout";
  return reading.in_trend ? "In trend" : "Later weigh-in";
}

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
  const latest = data?.readings.reduce<BodyFat["readings"][number] | undefined>(
    (newest, reading) =>
      newest &&
      Date.parse(newest.measured_at) >= Date.parse(reading.measured_at)
        ? newest
        : reading,
    undefined,
  );
  const trend = data?.trend;
  return (
    <section
      aria-label="Body fat"
      className="grid grid-cols-[minmax(0,1fr)] gap-3 p-0"
    >
      <div className="flex min-h-11 items-center justify-between gap-2">
        <h2 className={sectionHead}>Body fat</h2>
        <span className={hint}>%</span>
      </div>
      {bodyFat.isError && (
        <p role="alert" className="m-0">
          Couldn’t load body fat
        </p>
      )}
      {!data || !chart ? (
        bodyFat.isError ? null : online ? (
          <Skeleton label="Loading body fat" className="h-[30rem]" />
        ) : (
          <p className={hint}>Unavailable offline</p>
        )
      ) : !latest ? (
        <p className={hint}>No readings yet</p>
      ) : (
        <>
          <div className="flex items-baseline gap-6">
            <Metric
              value={String(latest.body_fat_pct)}
              unit="%"
              label={`Latest, ${shortDate(latest.day)}`}
            />
            {trend?.status === "ready" && (
              <Metric
                value={String(trend.level_pct)}
                unit="%"
                label="Trend"
                secondary
              />
            )}
          </div>
          <div className="grid gap-1">
            {trend?.lines.map((line, index) => (
              <p
                key={line}
                className={hint}
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
          </div>
          <Plot data={chart} series={bodyFatSeries} legend={keyOnly} />
          <div>
            <Disclosure summary="Readings">
              <ul className="m-0 list-none p-0">
                {data.readings.toReversed().map((reading) => (
                  <li
                    key={reading.id}
                    className="flex min-h-14 items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0"
                  >
                    <span className="grid gap-0.5">
                      <span className="numeric font-medium">
                        {reading.body_fat_pct}%
                      </span>
                      <span className={hint}>{shortDate(reading.day)}</span>
                    </span>
                    <span
                      className={cn(
                        hint,
                        reading.after_workout && "text-caution",
                      )}
                    >
                      {readingKind(reading)}
                    </span>
                  </li>
                ))}
              </ul>
            </Disclosure>
          </div>
        </>
      )}
    </section>
  );
}
