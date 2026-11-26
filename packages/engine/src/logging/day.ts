import { personDayBounds, wallTime } from "../calendar/time.ts";
import { OperationError } from "../operations/registry.ts";

export function canonicalInstant(input: string): string {
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      input,
    );
  if (!match) throw new OperationError(400, "invalid_time");
  const [, date, minutes, seconds = "00", fraction = "", offset] = match;
  // Stored timestamps keep milliseconds, so finer digits are dropped.
  const time = `${date}T${minutes}:${seconds}.${fraction.slice(0, 3).padEnd(3, "0")}`;
  const wall = `${time}Z`;
  const parsedWall = new Date(wall);
  const instant = new Date(`${time}${offset}`);
  if (
    !Number.isFinite(instant.getTime()) ||
    !Number.isFinite(parsedWall.getTime()) ||
    parsedWall.toISOString() !== wall
  )
    throw new OperationError(400, "invalid_time");
  return instant.toISOString();
}

export function localDay(
  timestamp: string,
  timezone: string,
  dayStartHour: number,
): string {
  return personDayAt(timestamp, timezone, dayStartHour).day;
}

export function shiftDay(day: string, days: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function personDayAt(
  timestamp: string,
  timezone: string,
  dayStartHour: number,
) {
  const instant = new Date(timestamp);
  const wall = wallTime(instant, timezone);
  if (wall.getUTCHours() < dayStartHour) wall.setUTCDate(wall.getUTCDate() - 1);
  const candidate = wall.toISOString().slice(0, 10);
  const boundsFor = (day: string) =>
    personDayBounds(day, timezone, dayStartHour);
  const candidateBounds = boundsFor(candidate);
  const day =
    instant < candidateBounds.start
      ? shiftDay(candidate, -1)
      : instant >= candidateBounds.end
        ? shiftDay(candidate, 1)
        : candidate;
  return { day, ...(day === candidate ? candidateBounds : boundsFor(day)) };
}
