import { windowsZones } from "./windows-zones.ts";

const formatters = new Map<string, Intl.DateTimeFormat>();
export const calendarDayMs = 86_400_000;

export function supportedZone(name: string): string {
  if (/^(UTC|GMT)?[+-]\d{1,2}(:?\d{2})?$/i.test(name))
    throw new Error("unsupported_timezone");
  const zone = Object.hasOwn(windowsZones, name) ? windowsZones[name] : name;
  if (!zone) throw new Error("unsupported_timezone");
  return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions()
    .timeZone;
}

export function wallTime(instant: Date, zone: string): Date {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(zone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return new Date(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${String(instant.getUTCMilliseconds()).padStart(3, "0")}Z`,
  );
}

export function wallInstant(
  wall: Date,
  zone: string,
  policy: "compatible" | "boundary" = "compatible",
): Date {
  const target = wall.getTime();
  if (!Number.isFinite(target)) throw new Error("invalid_time");
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 12) {
    const sample = new Date(target + hours * 3_600_000);
    offsets.add(wallTime(sample, zone).getTime() - sample.getTime());
  }
  const candidates = [...offsets]
    .map((offset) => target - offset)
    .sort((left, right) => left - right);
  const exact = candidates.find(
    (candidate) => wallTime(new Date(candidate), zone).getTime() === target,
  );
  if (exact !== undefined) return new Date(exact);
  const before = candidates.filter(
    (candidate) => wallTime(new Date(candidate), zone).getTime() < target,
  );
  const after = candidates.find(
    (candidate) => wallTime(new Date(candidate), zone).getTime() > target,
  );
  let lower = before.at(-1);
  if (lower === undefined || after === undefined)
    throw new Error("invalid_time");
  if (policy === "compatible") return new Date(after);
  let upper = after;
  while (lower + 1 < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (wallTime(new Date(middle), zone).getTime() >= target) upper = middle;
    else lower = middle;
  }
  return new Date(upper);
}

export function personDayBounds(
  day: string,
  timezone: string,
  dayStartHour: number,
): { start: Date; end: Date } {
  const wall = new Date(`${day}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(wall.getTime()) ||
    wall.toISOString().slice(0, 10) !== day ||
    !Number.isInteger(dayStartHour) ||
    dayStartHour < 0 ||
    dayStartHour > 23
  )
    throw new Error("invalid_day");
  wall.setUTCHours(dayStartHour);
  const zone = supportedZone(timezone);
  return {
    start: wallInstant(wall, zone, "boundary"),
    end: wallInstant(
      new Date(wall.getTime() + calendarDayMs),
      zone,
      "boundary",
    ),
  };
}
