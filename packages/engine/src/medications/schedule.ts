import { z } from "zod";
import { calendarDayMs, wallInstant, wallTime } from "../calendar/time.ts";
import { shiftDay } from "../logging/day.ts";
import type { ListRevisionsResult } from "../queries/medications/list-revisions.ts";

export const weekdays = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;
export const scheduleDays = z.array(z.enum(weekdays)).min(1).max(7);
export const scheduleTimes = z
  .array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/))
  .min(1)
  .max(1440);
export const horizonMs = 14 * calendarDayMs;

export function readSchedule(revision: ListRevisionsResult) {
  return {
    days: scheduleDays.parse(JSON.parse(revision.days)),
    times: scheduleTimes.parse(JSON.parse(revision.times)),
  };
}

export const slotKey = (slot: { slot_date: string; slot_time: string }) =>
  `${slot.slot_date}T${slot.slot_time}`;

export function slotInstant(
  slot: { slot_date: string; slot_time: string },
  zone: string,
) {
  return wallInstant(new Date(`${slotKey(slot)}:00.000Z`), zone).toISOString();
}

export function hasSlot(
  revision: ListRevisionsResult,
  slot: { slot_date: string; slot_time: string },
) {
  const { days, times } = readSchedule(revision);
  return (
    days.includes(weekday(slot.slot_date)) && times.includes(slot.slot_time)
  );
}

function weekday(day: string) {
  const name = weekdays[new Date(`${day}T00:00:00.000Z`).getUTCDay()];
  if (!name) throw new Error("Invalid medication slot date");
  return name;
}

export function expand(
  revision: ListRevisionsResult,
  from: string,
  until: string,
) {
  const start = from > revision.effective_from ? from : revision.effective_from;
  const end =
    revision.effective_to && revision.effective_to < until
      ? revision.effective_to
      : until;
  if (end <= start) return [];
  const { days, times } = readSchedule(revision);
  const first = shiftDay(
    wallTime(new Date(start), revision.timezone).toISOString().slice(0, 10),
    -1,
  );
  const last = wallTime(new Date(end), revision.timezone)
    .toISOString()
    .slice(0, 10);
  const slots = [];
  for (let day = first; day <= last; day = shiftDay(day, 1)) {
    if (!days.includes(weekday(day))) continue;
    for (const time of times) {
      const key = { slot_date: day, slot_time: time };
      const slot_at = slotInstant(key, revision.timezone);
      if (start <= slot_at && slot_at < end) slots.push({ ...key, slot_at });
    }
  }
  return slots;
}

export function nextSlot(
  revisions: ListRevisionsResult[],
  after: string,
  exclude?: Parameters<typeof slotKey>[0],
) {
  const start = exclude ? after : new Date(Date.parse(after) + 1).toISOString();
  const until = new Date(Date.parse(start) + horizonMs).toISOString();
  return revisions
    .flatMap((revision) => expand(revision, start, until))
    .filter(
      (slot) =>
        !exclude ||
        (slotKey(slot) !== slotKey(exclude) &&
          (slot.slot_at > after || slotKey(slot) > slotKey(exclude))),
    )
    .sort(
      (left, right) =>
        left.slot_at.localeCompare(right.slot_at) ||
        slotKey(left).localeCompare(slotKey(right)),
    )[0];
}
