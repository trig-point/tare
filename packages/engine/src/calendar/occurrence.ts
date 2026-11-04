import type { CalendarSource } from "./scan.ts";
import { wallInstant, wallTime } from "./time.ts";

export function rebuildStart(
  source: CalendarSource,
  wall: Date,
  generated: boolean,
): Date | undefined {
  // node-ical gives an override of an all-day series a midnight start.
  const start = generated ? wall : source.start.wall;
  const instant = wallInstant(start, source.start.zone);
  if (
    generated &&
    source.start.form !== "date" &&
    wallTime(instant, source.start.zone).getTime() !== start.getTime()
  )
    return undefined;
  return instant;
}

export function withinUntil(
  source: CalendarSource,
  series: CalendarSource,
  wall: Date,
): boolean {
  const position = source.recurrence ?? wall;
  if (series.until instanceof Date)
    return wallInstant(position, series.start.zone) <= series.until;
  if (typeof series.until === "string")
    return (
      position.toISOString().slice(0, 10).replaceAll("-", "") <= series.until
    );
  return true;
}
