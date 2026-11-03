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
  instant: string,
  timeZone: string,
  dayStartHour: number,
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const day = new Date(
    `${values.year}-${values.month}-${values.day}T00:00:00.000Z`,
  );
  if (Number(values.hour) < dayStartHour) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}
