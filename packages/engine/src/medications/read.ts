import type { Database } from "better-sqlite3";
import { z } from "zod";
import { calendarDayMs, personDayBounds } from "../calendar/time.ts";
import { shiftDay } from "../logging/day.ts";
import {
  type ListDosesResult,
  listDoses,
} from "../queries/medications/list-doses.ts";
import {
  type ListHoldsResult,
  listHolds,
} from "../queries/medications/list-holds.ts";
import type { ListMedicationsResult } from "../queries/medications/list-medications.ts";
import {
  type ListRevisionsResult,
  listRevisions,
} from "../queries/medications/list-revisions.ts";
import { nextSlot, slotKey } from "./schedule.ts";
import { type PersonDay, tareDay } from "./store.ts";

const instant = z.iso.datetime();
export const holdSchema = z.strictObject({
  id: z.number(),
  medication_id: z.number(),
  from_date: z.iso.date(),
  to_date: z.iso.date(),
});
const state = z.enum(["scheduled", "due", "late", "held", "taken", "skipped"]);
export const doseSchema = z.strictObject({
  id: z.number(),
  public_key: z.string(),
  medication_id: z.number(),
  slot_date: z.iso.date(),
  slot_time: z.string(),
  slot_at: instant,
  scheduled_at: instant,
  status: state,
  taken_at: instant.nullable(),
  skip_reason: z.enum(["user", "stopped"]).nullable(),
});
const nextSchema = z.strictObject({
  id: z.number().nullable(),
  public_key: z.string().nullable(),
  scheduled_at: instant,
  status: z.enum(["scheduled", "due", "late"]),
});
export const medicationSchema = z.strictObject({
  id: z.number(),
  name: z.string(),
  active: z.boolean(),
  late_after_minutes: z.number(),
  status: z
    .strictObject({
      next_dose: nextSchema.nullable(),
      late_count: z.number(),
      active_holds: z.array(holdSchema),
    })
    .nullable(),
});

function holdsOn(holds: ListHoldsResult[], day: string) {
  return holds.filter((hold) => hold.from_date <= day && day <= hold.to_date);
}

export function readDose(
  dose: ListDosesResult,
  medication: ListMedicationsResult,
  holds: ListHoldsResult[],
  person: PersonDay,
  now: string,
) {
  const {
    revision_id: _revision,
    resolved_at: _resolution,
    ...publicDose
  } = dose;
  let status = state.parse(dose.status);
  if (status === "scheduled") {
    if (holdsOn(holds, tareDay(dose.scheduled_at, person)).length)
      status = "held";
    else if (
      Date.parse(dose.scheduled_at) + medication.late_after_minutes * 60_000 <=
      Date.parse(now)
    )
      status = "late";
    else if (dose.scheduled_at <= now) status = "due";
  }
  return { ...publicDose, status };
}

function upcomingPlan(
  revisions: ListRevisionsResult[],
  doses: ListDosesResult[],
  holds: ListHoldsResult[],
  person: PersonDay,
  after: string,
) {
  const occupied = new Set(doses.map(slotKey));
  let cursor = after;
  let exclude: Parameters<typeof slotKey>[0] | undefined;
  for (;;) {
    const slot = nextSlot(revisions, cursor, exclude);
    if (!slot) return null;
    const held = holdsOn(holds, tareDay(slot.slot_at, person));
    if (held[0]) {
      const through = held.reduce(
        (latest, hold) => (hold.to_date > latest ? hold.to_date : latest),
        held[0].to_date,
      );
      if (through >= "9999-12-16") return null;
      exclude = undefined;
      const start = personDayBounds(
        shiftDay(through, 1),
        person.timezone,
        person.day_start_hour,
      ).start;
      cursor = new Date(start.getTime() - 1).toISOString();
    } else if (occupied.has(slotKey(slot))) {
      cursor = slot.slot_at;
      exclude = slot;
    } else {
      return {
        id: null,
        public_key: null,
        scheduled_at: slot.slot_at,
        status: "scheduled" as const,
      };
    }
  }
}

export function readMedication(
  database: Database,
  medication: ListMedicationsResult,
  person: PersonDay,
  now: string,
) {
  const { id, name, active, late_after_minutes } = medication;
  const base = { id, name, active: Boolean(active), late_after_minutes };
  if (!active) return { ...base, status: null };
  const holds = listHolds(database, { medication_id: id });
  const doses = listDoses(database, { medication_id: id });
  const views = doses.map((dose) =>
    readDose(dose, medication, holds, person, now),
  );
  const cutoff = new Date(Date.parse(now) - calendarDayMs).toISOString();
  const due = views.findLast(
    (dose) =>
      (dose.status === "due" || dose.status === "late") &&
      dose.scheduled_at >= cutoff,
  );
  const upcoming = due ?? views.find((dose) => dose.status === "scheduled");
  const next = upcoming
    ? {
        id: upcoming.id,
        public_key: upcoming.public_key,
        scheduled_at: upcoming.scheduled_at,
        status: upcoming.status,
      }
    : upcomingPlan(
        listRevisions(database, { medication_id: id }),
        doses,
        holds,
        person,
        now,
      );
  return {
    ...base,
    status: {
      next_dose: next,
      late_count: views.filter((dose) => dose.status === "late").length,
      active_holds: holdsOn(holds, tareDay(now, person)),
    },
  };
}
