import ICAL from "ical.js";
import ical, { type VEvent } from "node-ical";
import { calendarDayMs, supportedZone, wallInstant, wallTime } from "./time.ts";

type Property = [string, Record<string, unknown>, string, ...unknown[]];
type Component = [string, Property[], Component[]];
type Rule = Record<string, unknown>;
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
const timeProperties = new Set(["dtstart", "dtend", "recurrence-id", "exdate"]);
const propertyTypes: Record<string, string> = {
  uid: "text",
  duration: "duration",
  rrule: "recur",
  sequence: "integer",
  summary: "text",
  status: "text",
};
const numericRules: Record<string, [number, number]> = {
  count: [1, 2_147_483_647],
  interval: [1, 2_147_483_647],
  bysecond: [0, 60],
  byminute: [0, 59],
  byhour: [0, 23],
  bymonthday: [-31, 31],
  byyearday: [-366, 366],
  byweekno: [-53, 53],
  bymonth: [1, 12],
  bysetpos: [-366, 366],
};

function wallDate(value: string, dateOnly: boolean): Date {
  const normalized = dateOnly ? `${value}T00:00:00` : value.replace(/Z$/, "");
  const wall = new Date(`${normalized}.000Z`);
  if (
    !Number.isFinite(wall.getTime()) ||
    wall.toISOString() !== `${normalized}.000Z`
  )
    throw new Error("invalid_calendar_time");
  return wall;
}

function validateRule(raw: string): void {
  const names = new Set<string>();
  for (const part of raw.split(";")) {
    const [name = "", value = "", ...extra] = part.split("=");
    const key = name.toLowerCase();
    if (!value || extra.length || names.has(key))
      throw new Error("invalid_rule");
    names.add(key);
    const range = Object.hasOwn(numericRules, key)
      ? numericRules[key]
      : undefined;
    if (range) {
      for (const member of value.split(",")) {
        const number = Number(member);
        if (
          !/^[+-]?\d+$/.test(member) ||
          !Number.isInteger(number) ||
          number < range[0] ||
          number > range[1] ||
          (range[0] < 0 && number === 0) ||
          ((key === "count" || key === "interval") && value.includes(","))
        )
          throw new Error("invalid_rule");
      }
    } else if (!["freq", "until", "byday", "wkst"].includes(key)) {
      throw new Error("invalid_rule");
    }
  }
  if (!names.has("freq")) throw new Error("invalid_rule");
}

function parseTree(feed: string): Component {
  // ical.js accepts mismatched END names; this guard checks only component boundaries.
  const stack: string[] = [];
  let roots = 0;
  for (const line of feed.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    const boundary = /^(BEGIN|END):(.+)$/i.exec(line);
    if (!boundary) continue;
    const name = boundary[2]?.toLowerCase();
    if (!name) throw new Error("invalid_calendar");
    if (boundary[1]?.toUpperCase() === "BEGIN") {
      if (
        (!stack.length && (name !== "vcalendar" || roots++ !== 0)) ||
        (stack.length && name === "vcalendar") ||
        (name === "vevent" &&
          (stack.length !== 1 || stack[0] !== "vcalendar")) ||
        stack.length >= 32
      )
        throw new Error("invalid_calendar");
      stack.push(name);
    } else if (stack.pop() !== name) throw new Error("invalid_calendar");
  }
  if (stack.length || roots !== 1) throw new Error("invalid_calendar");
  const design = ICAL.design.icalendar;
  const savedTzid = design.param.tzid;
  const savedValue = design.param.value;
  const savedRecur = design.value.recur.fromICAL;
  const converters = ["date", "date-time", "integer"].map((type) => ({
    type,
    original: design.value[type].fromICAL as (raw: string) => string | number,
  }));
  design.param.tzid = { ...savedTzid, multiValue: "," };
  // A repeated VALUE becomes an array, which ical.js cannot read as a type.
  design.param.value = { ...savedValue, multiValue: "," };
  design.value.recur.fromICAL = (raw: string) => {
    validateRule(raw);
    return savedRecur(raw.toUpperCase());
  };
  for (const { type, original } of converters) {
    design.value[type].fromICAL = (raw: string) => {
      const value = original(raw);
      if (type === "integer") {
        if (!/^[+-]?\d+$/.test(raw) || !Number.isSafeInteger(value))
          throw new Error("invalid_integer");
      } else {
        if (
          typeof value !== "string" ||
          design.value[type].toICAL(value) !== raw
        )
          throw new Error("invalid_calendar_time");
        wallDate(value, type === "date");
      }
      return value;
    };
  }
  try {
    const root = ICAL.parse(feed) as Component;
    if (root[0] !== "vcalendar") throw new Error("invalid_calendar");
    const pending = [root];
    while (pending.length) {
      const component = pending.pop();
      if (!component) throw new Error("invalid_calendar");
      for (const property of component[1]) {
        if (!Object.hasOwn(property[1], "tzid")) continue;
        const tzid = property[1].tzid;
        if (typeof tzid !== "string" || !tzid) throw new Error("invalid_tzid");
        supportedZone(tzid);
        if (
          property[2] === "date" ||
          property
            .slice(3)
            .some((value) => typeof value === "string" && value.endsWith("Z"))
        )
          throw new Error("invalid_tzid");
      }
      for (const child of component[2]) {
        if (
          child[0] === "vcalendar" ||
          (child[0] === "vevent" && component !== root)
        )
          throw new Error("invalid_calendar");
        pending.push(child);
      }
    }
    return root;
  } finally {
    design.param.tzid = savedTzid;
    if (savedValue) design.param.value = savedValue;
    else delete design.param.value;
    design.value.recur.fromICAL = savedRecur;
    for (const { type, original } of converters)
      design.value[type].fromICAL = original;
  }
}

function readValue(
  raw: Property,
  personZone: string,
  value = raw[3],
): CalendarValue {
  if (
    (raw[2] !== "date" && raw[2] !== "date-time") ||
    typeof value !== "string"
  )
    throw new Error("invalid_calendar_time");
  const tzid = raw[1].tzid;
  const form =
    raw[2] === "date"
      ? "date"
      : tzid !== undefined
        ? "zoned"
        : value.endsWith("Z")
          ? "utc"
          : "floating";
  const zone =
    typeof tzid === "string"
      ? supportedZone(tzid)
      : form === "utc"
        ? "UTC"
        : personZone;
  return { wall: wallDate(value, form === "date"), form, zone };
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

function canonicalProperty(
  name: string,
  type: string,
  ...values: unknown[]
): Property {
  return [name, {}, type, ...values];
}

function untilBound(value: string, start: CalendarValue): Date | string {
  const bound = readValue(
    canonicalProperty(
      "until",
      value.length === 10 ? "date" : "date-time",
      value,
    ),
    start.zone,
  );
  if (start.form === "date") {
    const normalized = ical.sync.parseICS(
      ICAL.stringify([
        "vcalendar",
        [],
        [
          [
            "vevent",
            [
              canonicalProperty("uid", "text", "until"),
              canonicalProperty(
                "dtstart",
                "date",
                start.wall.toISOString().slice(0, 10),
              ),
              canonicalProperty("rrule", "recur", {
                freq: "DAILY",
                until: value,
              }),
            ],
            [],
          ],
        ],
      ]),
    ).until;
    const until =
      normalized?.type === "VEVENT"
        ? normalized.rrule?.options.until
        : undefined;
    if (!(until instanceof Date)) throw new Error("invalid_until");
    return stamp(until, true);
  }
  return bound.form === "date"
    ? new Date(
        wallInstant(
          new Date(bound.wall.getTime() + calendarDayMs),
          start.zone,
          "boundary",
        ).getTime() - 1,
      )
    : wallInstant(bound.wall, bound.zone);
}

export function scanCalendar(feed: string, requestedZone: string) {
  // node-ical builds DATE values from local fields, so they are UTC only here.
  for (const month of [0, 6])
    if (new Date(2027, month, 1).getTimezoneOffset() !== 0)
      throw new Error("process_timezone_not_utc");
  const personZone = supportedZone(requestedZone);
  const root = parseTree(feed);
  const candidates = root[2]
    .filter((component) => component[0] === "vevent")
    .map((component) => {
      const properties = new Map<string, Property>();
      for (const raw of component[1]) {
        const name = raw[0];
        if (name === "rdate" || name === "exrule")
          throw new Error(`unsupported_${name}`);
        if (!timeProperties.has(name) && !Object.hasOwn(propertyTypes, name))
          continue;
        if (name !== "exdate" && properties.has(name))
          throw new Error("duplicate_property");
        if (
          (name !== "exdate" && raw.length !== 4) ||
          (Object.hasOwn(propertyTypes, name) && raw[2] !== propertyTypes[name])
        )
          throw new Error("invalid_property");
        if (name === "recurrence-id" && Object.hasOwn(raw[1], "range"))
          throw new Error("unsupported_range");
        properties.set(
          name === "exdate" ? `exdate:${properties.size}` : name,
          raw,
        );
      }
      const uid = properties.get("uid")?.[3];
      const rawStart = properties.get("dtstart");
      if (typeof uid !== "string" || !uid) throw new Error("missing_uid");
      if (!rawStart) throw new Error("missing_start");
      if (properties.has("recurrence-id") && properties.has("rrule"))
        throw new Error("unsupported_override_rule");
      const sequence = properties.get("sequence")?.[3] ?? 0;
      if (typeof sequence !== "number" || sequence < 0)
        throw new Error("invalid_sequence");
      return {
        uid,
        properties,
        sequence,
        start: readValue(rawStart, personZone),
      };
    });
  const masters = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    if (
      !candidate.properties.has("recurrence-id") &&
      candidate.sequence >= (masters.get(candidate.uid)?.sequence ?? -1)
    )
      masters.set(candidate.uid, candidate);
  }
  // node-ical strips quotes and keys its own record by UID, so it never sees one.
  const identities = new Map<string, string>();
  for (const { uid } of candidates)
    if (!identities.has(uid))
      identities.set(uid, `event-${identities.size + 1}`);
  const winners = new Map<
    string,
    { component: Component; source: CalendarSource; sequence: number }
  >();
  for (const candidate of candidates) {
    const { uid, properties, start, sequence } = candidate;
    const identity = identities.get(uid) as string;
    const series = masters.get(uid)?.start;
    const source: CalendarSource = {
      start,
      recurring: properties.has("rrule"),
    };
    const rewritten: Property[] = [];
    let recurrenceForm: CalendarValue["form"] | undefined;
    for (const raw of properties.values()) {
      const name = raw[0];
      if (timeProperties.has(name)) {
        const values = raw.slice(3).map((member) => {
          const parsed = readValue(raw, personZone, member);
          const wall =
            name === "exdate" || name === "recurrence-id"
              ? exceptionWall(parsed, series ?? parsed)
              : parsed.wall;
          if (name === "dtend") source.end = parsed;
          if (name === "recurrence-id") {
            source.recurrence = wall;
            recurrenceForm = parsed.form;
          }
          return parsed.form === "date"
            ? wall.toISOString().slice(0, 10)
            : `${wall.toISOString().slice(0, 19)}Z`;
        });
        rewritten.push(canonicalProperty(name, raw[2], ...values));
      } else if (name === "rrule") {
        const rule = raw[3] as Rule;
        if (typeof rule.until === "string")
          source.until = untilBound(rule.until, start);
        rewritten.push(
          canonicalProperty(name, "recur", {
            freq: rule.freq,
            ...Object.fromEntries(
              Object.entries(rule).filter(
                ([key]) => key !== "freq" && key !== "until",
              ),
            ),
          }),
        );
      } else {
        if (name === "duration") source.duration = duration(String(raw[3]));
        rewritten.push(
          canonicalProperty(name, raw[2], name === "uid" ? identity : raw[3]),
        );
      }
    }
    const key = JSON.stringify([
      identity,
      source.recurrence
        ? `${recurrenceForm === "date" ? "DATE" : "INSTANT"}:${source.recurrence.toISOString()}`
        : "MASTER",
    ]);
    if (sequence >= (winners.get(key)?.sequence ?? -1))
      winners.set(key, {
        component: ["vevent", rewritten, []],
        source,
        sequence,
      });
  }
  const events = ical.sync.parseICS(
    ICAL.stringify([
      "vcalendar",
      [canonicalProperty("version", "text", "2.0")],
      [...winners.values()].map((winner) => winner.component),
    ]),
  );
  // Only top-level events and overrides of a recurring series are ever expanded.
  const expanded = new Set<string>();
  for (const entry of Object.values(events)) {
    if (entry?.type !== "VEVENT") continue;
    expanded.add(componentKey(entry));
    if (entry.rrule)
      for (const override of Object.values(entry.recurrences ?? {}))
        expanded.add(componentKey(override as VEvent));
  }
  for (const key of winners.keys())
    if (!expanded.has(key)) throw new Error("unreconciled_component");
  return {
    sources: new Map([...winners].map(([key, winner]) => [key, winner.source])),
    events,
  };
}
