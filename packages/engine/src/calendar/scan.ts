import ical, { type VEvent } from "node-ical";
import { calendarDayMs, supportedZone, wallInstant, wallTime } from "./time.ts";

type Property = {
  name: string;
  parameters: Record<string, string>;
  segments: string[];
  value: string;
};
export type CalendarValue = {
  wall: Date;
  form: "date" | "floating" | "utc" | "zoned";
  zone: string;
};
export type CalendarSource = {
  start: CalendarValue;
  end?: CalendarValue;
  duration?: { days: number; milliseconds: number };
  recurrence?: Date;
  until?: Date | string;
  recurring: boolean;
};

function splitQuoted(text: string, separator: string): string[] {
  const parts: string[] = [];
  let quoted = false;
  let begin = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '"') quoted = !quoted;
    if (!quoted && text[index] === separator) {
      parts.push(text.slice(begin, index));
      begin = index + 1;
    }
  }
  if (quoted) throw new Error("invalid_property");
  parts.push(text.slice(begin));
  return parts;
}

// Properties node-ical must keep exactly as the scanner read them.
const exactProperties = new Set([
  "UID",
  "DTSTART",
  "DTEND",
  "DURATION",
  "RECURRENCE-ID",
  "RRULE",
  "EXDATE",
  "SEQUENCE",
  "SUMMARY",
  "STATUS",
]);

function property(line: string): Property {
  let quoted = false;
  let colon = -1;
  for (let index = 0; index < line.length && colon < 0; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    else if (!quoted && line[index] === ":") colon = index;
  }
  if (colon < 1) throw new Error("invalid_property");
  const [name = "", ...segments] = splitQuoted(line.slice(0, colon), ";");
  const exact = exactProperties.has(name.toUpperCase());
  const parameters: Record<string, string> = {};
  for (const segment of segments) {
    const equal = segment.indexOf("=");
    if (equal < 1) throw new Error("invalid_parameter");
    const key = segment.slice(0, equal).toUpperCase();
    if (
      (exact || key === "TZID") &&
      (Object.hasOwn(parameters, key) ||
        !/^[\w-]+=(?:"[^"]*"|[^":;]+)$/.test(segment))
    )
      throw new Error("invalid_parameter");
    parameters[key] = segment.slice(equal + 1).replace(/^"(.*)"$/, "$1");
  }
  if (!name) throw new Error("invalid_property");
  return {
    name: name.toUpperCase(),
    parameters,
    segments,
    value: line.slice(colon + 1),
  };
}

function readValue(
  raw: Property,
  personZone: string,
  value = raw.value,
): CalendarValue {
  const tzid = raw.parameters.TZID;
  const form =
    raw.parameters.VALUE?.toUpperCase() === "DATE"
      ? "date"
      : tzid !== undefined
        ? "zoned"
        : value.endsWith("Z")
          ? "utc"
          : "floating";
  const zone =
    tzid !== undefined
      ? supportedZone(tzid)
      : form === "utc"
        ? "UTC"
        : personZone;
  const pattern =
    form === "date"
      ? /^\d{8}$/
      : form === "utc"
        ? /^\d{8}T\d{6}Z$/
        : /^\d{8}T\d{6}$/;
  if (!pattern.test(value)) throw new Error("invalid_calendar_time");
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const time =
    form === "date"
      ? "00:00:00"
      : `${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}`;
  const wall = new Date(`${date}T${time}.000Z`);
  if (
    !Number.isFinite(wall.getTime()) ||
    wall.toISOString() !== `${date}T${time}.000Z`
  )
    throw new Error("invalid_calendar_time");
  return { wall, form, zone };
}

function stamp(wall: Date, dateOnly: boolean): string {
  const text = wall.toISOString().replaceAll(/[-:]/g, "").slice(0, 15);
  return dateOnly ? text.slice(0, 8) : `${text}Z`;
}

function duration(value: string): NonNullable<CalendarSource["duration"]> {
  const match =
    /^\+?P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/.exec(
      value,
    );
  if (!match || !match.slice(1).some((part) => part !== undefined))
    throw new Error("invalid_duration");
  const [, weeks, days, hours, minutes, seconds] = match;
  const result = {
    days: Number(weeks ?? 0) * 7 + Number(days ?? 0),
    milliseconds:
      (Number(hours ?? 0) * 3600 +
        Number(minutes ?? 0) * 60 +
        Number(seconds ?? 0)) *
      1000,
  };
  if (
    !Number.isSafeInteger(result.days) ||
    !Number.isSafeInteger(result.milliseconds)
  )
    throw new Error("invalid_duration");
  return result;
}

export function componentKey(event: VEvent): string {
  const recurrence = event.recurrenceid;
  return JSON.stringify([
    event.uid,
    recurrence
      ? `${recurrence.dateOnly ? "DATE" : "INSTANT"}:${recurrence.toISOString()}`
      : "MASTER",
  ]);
}

function exceptionWall(value: CalendarValue, series: CalendarValue): Date {
  if (value.form === "date") return value.wall;
  if (series.form === "floating" && value.form !== "floating")
    throw new Error("ambiguous_exception");
  if (value.form === series.form && value.zone === series.zone)
    return value.wall;
  return wallTime(wallInstant(value.wall, value.zone), series.zone);
}

// node-ical builds DATE values from local fields, so they are UTC only here.
function requireUtcProcess(): void {
  for (const month of [0, 6])
    if (new Date(2027, month, 1).getTimezoneOffset() !== 0)
      throw new Error("process_timezone_not_utc");
}

export function scanCalendar(feed: string, requestedZone: string) {
  requireUtcProcess();
  const personZone = supportedZone(requestedZone);
  const components: Property[][] = [];
  const stack: string[] = [];
  let current: Property[] | undefined;
  let closed = false;
  for (const line of feed.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    if (!line) continue;
    const raw = property(line);
    const kind = raw.value.toUpperCase();
    if (raw.name === "BEGIN") {
      if (
        (kind === "VCALENDAR" && stack.length) ||
        (kind === "VEVENT" && stack.includes("VEVENT"))
      )
        throw new Error("invalid_calendar");
      stack.push(kind);
      if (stack.join("/") === "VCALENDAR/VEVENT") current = [];
    } else if (raw.name === "END") {
      if (stack.pop() !== kind) throw new Error("invalid_calendar");
      if (kind === "VEVENT" && current) {
        components.push(current);
        current = undefined;
      }
      if (kind === "VCALENDAR") closed = true;
    } else if (current && stack.join("/") === "VCALENDAR/VEVENT") {
      current.push(raw);
    }
  }
  if (stack.length || !closed) throw new Error("invalid_calendar");
  for (const properties of components) {
    const names = properties.map((entry) => entry.name);
    for (const name of exactProperties)
      if (name !== "EXDATE" && names.indexOf(name) !== names.lastIndexOf(name))
        throw new Error("duplicate_property");
    if (names.includes("RECURRENCE-ID") && names.includes("RRULE"))
      throw new Error("unsupported_override_rule");
  }
  const starts = components.map((properties) => {
    const raw = properties.find((entry) => entry.name === "DTSTART");
    if (!raw) throw new Error("missing_start");
    return readValue(raw, personZone);
  });
  const uids = components.map((properties) => {
    const uid = properties.find((entry) => entry.name === "UID")?.value;
    if (!uid) throw new Error("missing_uid");
    return uid;
  });
  const masters = new Map<string, { start: CalendarValue; sequence: number }>();
  for (const [index, properties] of components.entries()) {
    const uid = uids[index] as string;
    if (properties.some((entry) => entry.name === "RECURRENCE-ID")) continue;
    const sequence = Number(
      properties.find((entry) => entry.name === "SEQUENCE")?.value ?? 0,
    );
    const normalized = Number.isFinite(sequence) ? sequence : 0;
    const start = starts[index];
    if (!start) throw new Error("missing_start");
    if (!masters.has(uid) || normalized >= (masters.get(uid)?.sequence ?? 0))
      masters.set(uid, { start, sequence: normalized });
  }
  const sources = new Map<string, CalendarSource>();
  const sequences = new Map<string, number>();
  const rewritten: string[] = [];
  for (const [index, properties] of components.entries()) {
    const start = starts[index];
    if (!start) throw new Error("missing_start");
    const series = masters.get(uids[index] as string)?.start;
    const source: CalendarSource = {
      start,
      recurring: properties.some((entry) => entry.name === "RRULE"),
    };
    const lines: string[] = [];
    let untilText: string | undefined;
    for (const raw of properties) {
      let value = raw.value;
      if (raw.parameters.TZID !== undefined) supportedZone(raw.parameters.TZID);
      if (raw.name === "RECURRENCE-ID" && raw.parameters.RANGE !== undefined)
        throw new Error("unsupported_range");
      if (["DTSTART", "DTEND", "RECURRENCE-ID", "EXDATE"].includes(raw.name)) {
        value = (raw.name === "EXDATE" ? value.split(",") : [value])
          .map((member) => {
            const parsed = readValue(raw, personZone, member);
            const wall = ["RECURRENCE-ID", "EXDATE"].includes(raw.name)
              ? exceptionWall(parsed, series ?? parsed)
              : parsed.wall;
            if (raw.name === "DTEND") source.end = parsed;
            if (raw.name === "RECURRENCE-ID") source.recurrence = wall;
            return stamp(wall, parsed.form === "date");
          })
          .join(",");
      } else if (raw.name === "DURATION") source.duration = duration(value);
      else if (raw.name === "RRULE") {
        const rules = value.split(";").map((rule) => {
          const equal = rule.indexOf("=");
          if (equal < 1) throw new Error("invalid_rule");
          return [rule.slice(0, equal).toUpperCase(), rule.slice(equal + 1)];
        });
        const names = rules.map(([name]) => name);
        if (new Set(names).size !== names.length || !names.includes("FREQ"))
          throw new Error("invalid_rule");
        untilText = rules.find(([name]) => name === "UNTIL")?.[1];
        if (untilText !== undefined) {
          const bound = readValue(
            {
              name: "UNTIL",
              parameters: /^\d{8}$/.test(untilText) ? { VALUE: "DATE" } : {},
              segments: [],
              value: untilText,
            },
            start.zone,
          );
          if (bound.form === "date" && start.form !== "date")
            source.until = new Date(
              wallInstant(
                new Date(bound.wall.getTime() + calendarDayMs),
                start.zone,
                "boundary",
              ).getTime() - 1,
            );
          else if (start.form !== "date")
            source.until = wallInstant(bound.wall, bound.zone);
        }
        value = [
          ...rules.filter(([name]) => name === "FREQ"),
          ...rules.filter(([name]) => name !== "FREQ" && name !== "UNTIL"),
        ]
          .map((rule) => rule.join("="))
          .join(";");
      }
      const segments = raw.segments.filter(
        (segment) => !/^TZID=/i.test(segment),
      );
      lines.push(
        `${raw.name}${segments.map((segment) => `;${segment}`).join("")}:${value}`,
      );
    }
    const isolated = ical.sync.parseICS(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        ...lines,
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    );
    const event = Object.values(isolated).find(
      (entry): entry is VEvent => entry?.type === "VEVENT",
    );
    if (!event) throw new Error("missing_component");
    if (start.form === "date" && untilText) {
      const bounded = ical.sync.parseICS(
        [
          "BEGIN:VCALENDAR",
          "BEGIN:VEVENT",
          `UID:until`,
          `DTSTART;VALUE=DATE:${stamp(start.wall, true)}`,
          `RRULE:FREQ=DAILY;UNTIL=${untilText}`,
          "END:VEVENT",
          "END:VCALENDAR",
        ].join("\r\n"),
      );
      const normalized = bounded.until;
      const bound =
        normalized?.type === "VEVENT"
          ? normalized.rrule?.options.until
          : undefined;
      if (!(bound instanceof Date)) throw new Error("invalid_until");
      source.until = stamp(bound, true);
    }
    const key = componentKey(event);
    const sequence = Number.isFinite(event.sequence)
      ? (event.sequence as number)
      : 0;
    if (!sources.has(key) || sequence >= (sequences.get(key) ?? 0)) {
      sources.set(key, source);
      sequences.set(key, sequence);
    }
    rewritten.push("BEGIN:VEVENT", ...lines, "END:VEVENT");
  }
  return {
    sources,
    events: ical.sync.parseICS(
      ["BEGIN:VCALENDAR", "VERSION:2.0", ...rewritten, "END:VCALENDAR"].join(
        "\r\n",
      ),
    ),
  };
}
