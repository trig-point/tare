import type { CalendarSource } from "./scan.ts";
import { wallInstant, wallTime } from "./time.ts";

export function rebuildStart(
  source: CalendarSource,
  wall: Date,
  generated: boolean,
): Date | undefined {
  const instant = wallInstant(wall, source.start.zone);
  if (
    generated &&
    wallTime(instant, source.start.zone).getTime() !== wall.getTime()
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
