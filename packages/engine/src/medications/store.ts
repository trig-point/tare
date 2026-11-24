import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { calendarDayMs, personDayBounds, wallTime } from "../calendar/time.ts";
import { writeTransaction } from "../db.ts";
import { localDay, shiftDay } from "../logging/day.ts";
import { OperationError } from "../operations/registry.ts";
import { deleteDose } from "../queries/medications/delete-dose.ts";
import { endRevision } from "../queries/medications/end-revision.ts";
import { insertDose } from "../queries/medications/insert-dose.ts";
import { insertMedication } from "../queries/medications/insert-medication.ts";
import { insertRevision } from "../queries/medications/insert-revision.ts";
import {
  type ListDosesResult,
  listDoses,
} from "../queries/medications/list-doses.ts";
import {
  type ListMedicationsResult,
  listMedications,
} from "../queries/medications/list-medications.ts";
import {
  type ListRevisionsResult,
  listRevisions,
} from "../queries/medications/list-revisions.ts";
import { replanDose } from "../queries/medications/replan-dose.ts";
import { setHorizon } from "../queries/medications/set-horizon.ts";
import { updateDose } from "../queries/medications/update-dose.ts";
import { updateMedication } from "../queries/medications/update-medication.ts";
import {
  expand,
  hasSlot,
  horizonMs,
  nextSlot,
  readSchedule,
  slotInstant,
} from "./schedule.ts";

export type PersonDay = { timezone: string; day_start_hour: number };
type Schedule = ReturnType<typeof readSchedule>;
type Medication = ListMedicationsResult;
type Revision = ListRevisionsResult;

export function requireMedication(database: Database, id: number) {
  const medication = listMedications(database).find((row) => row.id === id);
  if (!medication) throw new OperationError(404, "not_found");
  return medication;
}

export const tareDay = (instant: string, person: PersonDay) =>
  localDay(instant, person.timezone, person.day_start_hour);

export function covers(revision: Revision, instant: string) {
  return (
    revision.effective_from <= instant &&
    (revision.effective_to === null || instant < revision.effective_to)
  );
}

export function generate(
  database: Database,
  medication: Medication,
  now: string,
) {
  if (!medication.active) return 0;
  const until = new Date(Date.parse(now) + horizonMs).toISOString();
  if (medication.generated_until >= until) return 0;
  let added = 0;
  for (const revision of listRevisions(database, {
    medication_id: medication.id,
  })) {
    for (const slot of expand(revision, medication.generated_until, until)) {
      added += insertDose(database, {
        ...slot,
        public_key: randomUUID(),
        medication_id: medication.id,
        revision_id: revision.id,
        scheduled_at: slot.slot_at,
      }).changes;
    }
  }
  setHorizon(database, { generated_until: until }, { id: medication.id });
  return added;
}

export function generateAll(database: Database, now: Date) {
  return writeTransaction(database, () =>
    listMedications(database).reduce(
      (added, medication) =>
        added + generate(database, medication, now.toISOString()),
      0,
    ),
  );
}

function append(
  database: Database,
  medication_id: number,
  effective_from: string,
  timezone: string,
  schedule: Schedule,
  effective_to: string | null = null,
) {
  const revision = insertRevision(database, {
    medication_id,
    effective_from,
    effective_to,
    timezone,
    days: JSON.stringify(schedule.days),
    times: JSON.stringify(schedule.times),
  });
  if (!revision) throw new Error("Missing medication revision");
  return revision;
}

function cancelPending(database: Database, revisions: Revision[], now: string) {
  for (const revision of revisions) {
    if (
      revision.effective_from > now &&
      revision.effective_to !== revision.effective_from
    )
      endRevision(
        database,
        { effective_to: revision.effective_from },
        revision,
      );
  }
}

function plannedSlot(
  plans: Revision[],
  dose: ListDosesResult,
  eligible: (instant: string) => boolean = () => true,
) {
  for (const revision of plans) {
    if (!hasSlot(revision, dose)) continue;
    const instant = slotInstant(dose, revision.timezone);
    if (covers(revision, instant) && eligible(instant))
      return { revision, instant };
  }
}

function retainsSlotAtCutover(
  revision: Revision,
  dose: ListDosesResult,
  start: string,
) {
  return (
    revision.effective_from === start &&
    hasSlot(revision, dose) &&
    slotInstant(dose, revision.timezone) <= start
  );
}

function applySlot(
  database: Database,
  dose: ListDosesResult,
  slot: { revision: Revision; instant: string },
  scheduled_at: string,
) {
  const timing = {
    revision_id: slot.revision.id,
    slot_at: slot.instant,
    scheduled_at,
  };
  if (replanDose(database, timing, dose).changes !== 1)
    throw new Error("Missing scheduled dose during replanning");
  return { ...dose, ...timing };
}

export function undoDose(
  database: Database,
  medication: Medication,
  dose: ListDosesResult,
  now: string,
) {
  if (!medication.active) throw new OperationError(409, "medication_inactive");
  if (dose.status !== "taken" && dose.skip_reason !== "user")
    throw new OperationError(409, "invalid_dose_state");
  if (!dose.resolved_at) throw new Error("Missing dose resolution time");
  const elapsed = Date.parse(now) - Date.parse(dose.resolved_at);
  if (elapsed < 0 || elapsed > calendarDayMs)
    throw new OperationError(409, "undo_expired");
  return changeDose(database, dose, "scheduled", null, null, dose.slot_at);
}

function replan(
  database: Database,
  medication: Medication,
  start: string,
  plans: Revision[],
  timezoneEdit: boolean,
) {
  for (const dose of listDoses(database, { medication_id: medication.id })) {
    if (
      dose.status !== "scheduled" ||
      dose.slot_at < start ||
      (timezoneEdit && dose.slot_at === start)
    )
      continue;
    const match = plannedSlot(
      plans,
      dose,
      (instant) => !timezoneEdit || instant > start,
    );
    if (match) {
      const snoozed =
        match.instant === dose.slot_at && dose.scheduled_at > dose.slot_at;
      const next = snoozed && nextSlot(plans, match.instant, dose);
      const keepSnooze = snoozed && (!next || dose.scheduled_at < next.slot_at);
      applySlot(
        database,
        dose,
        match,
        keepSnooze ? dose.scheduled_at : match.instant,
      );
    } else if (
      !timezoneEdit ||
      !plans.some((revision) => retainsSlotAtCutover(revision, dose, start))
    ) {
      deleteDose(database, dose);
    }
  }
}

export function editDaySettings(
  database: Database,
  person: PersonDay,
  previous: PersonDay,
  now: string,
) {
  for (const medication of listMedications(database)) {
    if (!medication.active) continue;
    generate(database, medication, now);
    const revisions = listRevisions(database, { medication_id: medication.id });
    const current = revisions.find((revision) => covers(revision, now));
    if (!current) throw new Error("Missing current medication revision");
    const pending = revisions.find(
      (revision) =>
        revision.effective_to === null && revision.effective_from > now,
    );
    if (!pending && current.timezone === person.timezone) continue;
    cancelPending(database, revisions, now);
    endRevision(database, { effective_to: now }, current);
    const pendingStart =
      pending &&
      personDayBounds(
        tareDay(pending.effective_from, previous),
        person.timezone,
        person.day_start_hour,
      ).start.toISOString();
    const rebased = pendingStart && pendingStart > now ? pendingStart : null;
    const plans = [
      append(
        database,
        medication.id,
        now,
        person.timezone,
        readSchedule(pending && !rebased ? pending : current),
        rebased,
      ),
    ];
    if (pending && rebased)
      plans.push(
        append(
          database,
          medication.id,
          rebased,
          person.timezone,
          readSchedule(pending),
        ),
      );
    replan(database, medication, now, plans, true);
    generate(database, { ...medication, generated_until: now }, now);
  }
}

export type SaveInput = Partial<Schedule> & {
  id?: number;
  name?: string;
  active?: boolean;
  late_after_minutes?: number;
};

export function saveMedication(
  database: Database,
  person: PersonDay,
  now: string,
  input: SaveInput,
) {
  const stored =
    input.id === undefined ? undefined : requireMedication(database, input.id);
  const name = input.name ?? stored?.name;
  const active = Number(input.active ?? Boolean(stored?.active ?? 1));
  const late_after_minutes =
    input.late_after_minutes ?? stored?.late_after_minutes ?? 60;
  const revisions = stored
    ? listRevisions(database, { medication_id: stored.id })
    : [];
  const latest = revisions.reduce<Revision | undefined>(
    (latest, revision) =>
      !latest || revision.id > latest.id ? revision : latest,
    undefined,
  );
  const previous = latest && readSchedule(latest);
  const days = input.days ?? previous?.days;
  const times = input.times ?? previous?.times;
  if (!name || !days || !times)
    throw new OperationError(400, "invalid_request");
  const schedule = {
    days: [...new Set(days)].sort(),
    times: [...new Set(times)].sort(),
  };
  const data = { name, active, late_after_minutes };
  if (!stored) {
    const medication = insertMedication(database, {
      ...data,
      generated_until: now,
    });
    if (!medication) throw new Error("Missing new medication");
    append(
      database,
      medication.id,
      now,
      person.timezone,
      schedule,
      active ? null : now,
    );
    generate(database, medication, now);
    return medication.id;
  }

  let generated_until = stored.generated_until;
  generate(database, stored, now);
  if (stored.active)
    generated_until = requireMedication(database, stored.id).generated_until;
  const changed = JSON.stringify(schedule) !== JSON.stringify(previous);
  if (!active && (stored.active || changed)) {
    cancelPending(database, revisions, now);
    const current = revisions.find((revision) => covers(revision, now));
    if (current) endRevision(database, { effective_to: now }, current);
    append(database, stored.id, now, person.timezone, schedule, now);
    if (stored.active) {
      for (const dose of listDoses(database, { medication_id: stored.id })) {
        if (dose.status !== "scheduled") continue;
        if (dose.slot_at > now) deleteDose(database, dose);
        else
          changeDose(
            database,
            dose,
            "skipped",
            null,
            "stopped",
            dose.scheduled_at,
            now,
          );
      }
    }
  } else if (active && !stored.active) {
    append(database, stored.id, now, person.timezone, schedule);
    generated_until = now;
  } else if (active && changed) {
    const day = tareDay(now, person);
    let next = personDayBounds(
      day,
      person.timezone,
      person.day_start_hour,
    ).end.toISOString();
    if (next <= now) {
      const wallNow = wallTime(new Date(now), person.timezone).getTime();
      const wallBoundary = Date.parse(
        `${shiftDay(day, 1)}T${String(person.day_start_hour).padStart(2, "0")}:00:00.000Z`,
      );
      next = new Date(Date.parse(now) + wallBoundary - wallNow).toISOString();
    }
    cancelPending(database, revisions, now);
    const current = revisions.find((revision) => covers(revision, now));
    if (!current) throw new Error("Missing current medication revision");
    endRevision(database, { effective_to: next }, current);
    const plan = append(database, stored.id, next, person.timezone, schedule);
    replan(database, stored, next, [plan], false);
    generated_until = next;
  }
  const medication = { id: stored.id, ...data, generated_until };
  updateMedication(database, medication, medication);
  generate(database, medication, now);
  return medication.id;
}

export function changeDose(
  database: Database,
  dose: ListDosesResult,
  status: "scheduled" | "taken" | "skipped",
  taken_at: string | null = null,
  skip_reason: "user" | "stopped" | null = null,
  scheduled_at = dose.scheduled_at,
  resolved_at: string | null = null,
) {
  const [updated] = updateDose(
    database,
    { status, taken_at, skip_reason, scheduled_at, resolved_at },
    dose,
  );
  if (!updated) throw new Error("Missing updated dose");
  return updated;
}
