import { z as zod } from "zod";

const text = (max: number) =>
  zod.string().max(max).regex(/\S/, "must not be blank");
export const sessionKey = zod
  .string()
  .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/)
  .max(40);
export const weekdays = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;

export const movement = zod.strictObject({
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
  alternates: zod.array(sessionKey).max(10).optional(),
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
      if (/^(UTC|GMT)?[+-]\d/i.test(zone)) return false;
      try {
        new Intl.DateTimeFormat("en", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    }, "timezone is not an IANA zone"),
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
    for (const [name, entry] of Object.entries(document.sessions))
      entry.alternates?.forEach((key, index) =>
        known(key, ["sessions", name, "alternates", index]),
      );
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
      if (entry.kind !== "lift") continue;
      const keys = groupKeys(document, entry.session);
      if (!keys.length)
        refuse(["week", day, "session"], `unknown session ${entry.session}`);
      else if (
        !keys.includes(entry.session) &&
        !document.rotation.some((key) => keys.includes(key))
      )
        refuse(["week", day, "session"], `no ${entry.session} in rotation`);
    }
  });

export type ScheduleDocument = zod.output<typeof scheduleDocument>;

// A week lift day names a session key or a group: the text before a key's first underscore.
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
  const weekday =
    weekdays[(new Date(`${day}T00:00:00.000Z`).getUTCDay() + 6) % 7];
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
  return { day, source, ...sessionFields(document, key) };
}

function sessionFields(document: ScheduleDocument, key: string) {
  const picked = document.sessions[key];
  if (!picked) throw new Error("Schedule session missing");
  return {
    kind: "lift" as const,
    name: picked.name,
    session: key,
    where: picked.where,
    note: picked.note ?? null,
    movements: picked.movements,
  };
}

export function sessionAlternates(
  document: ScheduleDocument,
  today: TodayEntry,
) {
  const scheduled = today.session ? document.sessions[today.session] : null;
  return (scheduled?.alternates ?? []).map((key) => {
    const { name, where } = sessionFields(document, key);
    return { key, name, where };
  });
}

export function chooseSession(
  document: ScheduleDocument,
  today: TodayEntry,
  key: string,
): TodayEntry | null {
  if (key === today.session) return today;
  if (!sessionAlternates(document, today).some((entry) => entry.key === key))
    return null;
  return { ...today, ...sessionFields(document, key) };
}

function pickSession(document: ScheduleDocument, name: string): string {
  if (Object.hasOwn(document.sessions, name)) return name;
  const keys = groupKeys(document, name);
  if (document.next_session && keys.includes(document.next_session))
    return document.next_session;
  const next = document.rotation.find((key) => keys.includes(key));
  if (!next) throw new Error("Schedule group missing from rotation");
  return next;
}
