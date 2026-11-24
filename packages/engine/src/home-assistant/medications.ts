import type { Database } from "better-sqlite3";
import { z } from "zod";
import { calendarDayMs, personDayBounds } from "../calendar/time.ts";
import { writeTransaction } from "../db.ts";
import {
  dosesOnDay,
  medicationRows,
  readDose,
  readMedication,
} from "../medications/read.ts";
import { recordTakenDose, tareDay } from "../medications/store.ts";
import { selectInstallId } from "../queries/home-assistant/select-install-id.ts";
import { listMedications } from "../queries/medications/list-medications.ts";
import { selectPerson } from "../queries/select-person.ts";
import type { Person, Provider } from "./discovery.ts";
import { systemClock } from "./publisher.ts";

const pressInput = z.strictObject({ dose_key: z.uuid() });

export const medicationPressTopic = (install: string, userId: number) =>
  `tare/${install}/${userId}/medication_press`;

export function pressMedication(
  database: Database,
  person: Person,
  doseKey: string,
  now: string,
) {
  return writeTransaction(database, () => {
    for (const medication of listMedications(database)) {
      if (!medication.active) continue;
      const { doses, holds } = medicationRows(database, medication.id);
      const dose = doses.find((row) => row.public_key === doseKey);
      if (!dose) continue;
      const { status } = readDose(dose, medication, holds, person, now);
      if (status === "due" || status === "late") {
        recordTakenDose(database, person, medication, dose, now, now);
        return "logged";
      }
    }
    return "dose_exists";
  });
}

export function medicationProvider({
  database,
  publisher,
  clock = systemClock,
  log = console.error,
}: {
  database: Database;
  publisher: {
    refreshAll(): void;
    subscribe(topic: string, handler: (payload: Buffer) => void): void;
  };
  clock?: { now(): Date };
  log?: (code: string, detail?: string) => void;
}): Provider {
  const install = selectInstallId(database)?.id;
  if (!install) throw new Error("Install id missing");
  const subscribed = new Set<number>();

  const subscribe = (userId: number) => {
    if (subscribed.has(userId)) return;
    subscribed.add(userId);
    publisher.subscribe(medicationPressTopic(install, userId), (payload) => {
      let input: z.infer<typeof pressInput>;
      try {
        input = pressInput.parse(JSON.parse(payload.toString()));
      } catch {
        log("medication_press_ignored", "invalid_press");
        return;
      }
      const person = selectPerson(database, { id: userId });
      if (!person) return;
      const result = pressMedication(
        database,
        person,
        input.dose_key,
        clock.now().toISOString(),
      );
      if (result === "logged") publisher.refreshAll();
      else log("medication_press_ignored", result);
    });
  };

  return (person) => {
    subscribe(person.id);
    const instant = clock.now();
    const now = instant.toISOString();
    const day = tareDay(now, person);
    let wake = personDayBounds(
      day,
      person.timezone,
      person.day_start_hour,
    ).end.getTime();
    const consider = (time: number) => {
      if (time > instant.getTime() && time < wake) wake = time;
    };
    const entities = [];
    const state: Record<string, string> = {};
    for (const medication of listMedications(database)) {
      if (!medication.active) continue;
      const rows = medicationRows(database, medication.id);
      const view = readMedication(
        database,
        medication,
        person,
        now,
        rows,
      ).status;
      if (!view) continue;
      const { next_dose: next, active_holds: holds, late_count } = view;
      const today = dosesOnDay(rows.doses, person, day);
      let sensorState: string = next?.status ?? "scheduled";
      if (sensorState === "scheduled") {
        if (holds.length) sensorState = "held";
        else if (
          !today.some((dose) => dose.status === "scheduled") &&
          today.some((dose) => dose.status === "taken")
        )
          sensorState = "taken";
      }
      const key = `medication_${medication.id}`;
      const topic = `tare/${install}/${person.id}/${key}`;
      entities.push({
        component: "sensor" as const,
        key,
        config: {
          name: medication.name,
          state_topic: topic,
          value_template: "{{ value_json.state }}",
          json_attributes_topic: topic,
          json_attributes_template:
            "{{ {'next_dose_key': value_json.next_dose_key, 'next_dose_at': value_json.next_dose_at, 'late_count': value_json.late_count} | tojson }}",
        },
      });
      state[topic] = JSON.stringify({
        state: sensorState,
        next_dose_key: next?.public_key ?? null,
        next_dose_at: next?.scheduled_at ?? null,
        late_count,
      });

      for (const dose of rows.doses) {
        if (
          dose.status !== "scheduled" ||
          readDose(dose, medication, rows.holds, person, now).status === "held"
        )
          continue;
        const at = Date.parse(dose.scheduled_at);
        consider(at);
        consider(at + medication.late_after_minutes * 60_000);
        consider(at + calendarDayMs + 1);
      }
      consider(Date.parse(medication.generated_until) - calendarDayMs);
    }
    return { entities, state, refreshAt: new Date(wake) };
  };
}
