import { z as zod } from "zod";
import { supportedZone } from "../calendar/time.ts";

const text = (max: number) => zod.string().min(1).max(max);
const sessionKey = zod
  .string()
  .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/)
  .max(40);
export const weekdays = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;

const movement = zod.strictObject({
  name: text(120),
  load: text(80).optional(),
  sets: zod.number().int().min(1).max(20),
  reps: text(40),
  rir: text(40).optional(),
  rest_s: text(40).optional(),
  note: text(200).optional(),
});
const session = zod.strictObject({
  name: text(80),
  where: text(80),
  note: text(200).optional(),
  movements: zod.array(movement).max(30),
});
const lift = zod.strictObject({
  kind: zod.literal("lift"),
  session: sessionKey,
});
const other = zod.strictObject({
  kind: zod.enum(["cardio", "rest"]),
  label: text(120),
});
const weekDay = zod.discriminatedUnion("kind", [lift, other]);
const planned = zod.union([
  zod.strictObject({
    date: zod.iso.date(),
    kind: zod.literal("lift").optional(),
    session: sessionKey,
  }),
  other.extend({ date: zod.iso.date() }),
]);

export const scheduleDocument = zod
  .strictObject({
    version: zod.literal(1),
    updated: zod.iso.datetime().optional(),
    updated_by: text(80).optional(),
    timezone: text(64).refine((zone) => {
      try {
        supportedZone(zone);
        return true;
      } catch {
        return false;
      }
    }, "timezone is not a supported IANA zone"),
    week: zod.strictObject(
      Object.fromEntries(weekdays.map((day) => [day, weekDay])) as Record<
        (typeof weekdays)[number],
        typeof weekDay
      >,
    ),
    rotation: zod.array(sessionKey).max(40),
    next_session: sessionKey.nullable(),
    planned: zod.array(planned).max(400),
    sessions: zod.record(sessionKey, session),
  })
  .superRefine((document, context) => {
    const keys = new Set(Object.keys(document.sessions));
    const refuse = (path: (string | number)[], message: string) =>
      context.addIssue({ code: "custom", path, message });
    const known = (key: string, path: (string | number)[]) => {
      if (!keys.has(key)) refuse(path, `unknown session ${key}`);
    };
    document.rotation.forEach((key, index) => known(key, ["rotation", index]));
    if (document.next_session !== null)
      known(document.next_session, ["next_session"]);
    const dates = new Set<string>();
    document.planned.forEach((entry, index) => {
      if (dates.has(entry.date))
        refuse(["planned", index, "date"], `duplicate date ${entry.date}`);
      dates.add(entry.date);
      if ("session" in entry)
        known(entry.session, ["planned", index, "session"]);
    });
    for (const day of weekdays) {
      const entry = document.week[day];
      if (entry.kind === "lift" && !groupKeys(document, entry.session).length)
        refuse(["week", day, "session"], `unknown session ${entry.session}`);
    }
  });

export type ScheduleDocument = zod.output<typeof scheduleDocument>;

// A week lift day names a session key, or a group: the text before a key's first underscore.
function groupKeys(
  document: Pick<ScheduleDocument, "sessions">,
  name: string,
): string[] {
  if (Object.hasOwn(document.sessions, name)) return [name];
  return Object.keys(document.sessions).filter(
    (key) => key.split("_")[0] === name,
  );
}

export const todayEntry = zod.strictObject({
  day: zod.iso.date(),
  source: zod.enum(["planned", "week"]),
  kind: zod.enum(["lift", "cardio", "rest"]),
  name: zod.string(),
  session: zod.string().nullable(),
  where: zod.string().nullable(),
  note: zod.string().nullable(),
  movements: zod.array(movement),
});
export type TodayEntry = zod.output<typeof todayEntry>;

export function resolveToday(
  document: ScheduleDocument,
  day: string,
): TodayEntry {
  const dated = document.planned.find((entry) => entry.date === day);
  const weekday = weekdays[new Date(`${day}T00:00:00.000Z`).getUTCDay()];
  const template = weekday ? document.week[weekday] : undefined;
  const entry = dated ?? template;
  if (!entry) throw new Error("Schedule day missing");
  const source = dated ? "planned" : "week";
  if (!("session" in entry))
    return {
      day,
      source,
      kind: entry.kind,
      name: entry.label,
      session: null,
      where: null,
      note: null,
      movements: [],
    };
  const key = dated ? entry.session : pickSession(document, entry.session);
  const picked = document.sessions[key];
  if (!picked) throw new Error("Schedule session missing");
  return {
    day,
    source,
    kind: "lift",
    name: picked.name,
    session: key,
    where: picked.where,
    note: picked.note ?? null,
    movements: picked.movements,
  };
}

function pickSession(document: ScheduleDocument, name: string): string {
  const keys = groupKeys(document, name);
  if (document.next_session && keys.includes(document.next_session))
    return document.next_session;
  return document.rotation.find((key) => keys.includes(key)) ?? keys[0] ?? name;
}
