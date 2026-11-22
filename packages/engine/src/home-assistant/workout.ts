import type { Database } from "better-sqlite3";
import { localDay } from "../logging/day.ts";
import { selectInstallId } from "../queries/home-assistant/select-install-id.ts";
import { readSchedule } from "../workout/operations.ts";
import { resolveToday } from "../workout/schedule.ts";
import type { Provider } from "./discovery.ts";

export const workoutTopic = (install: string, userId: number) =>
  `tare/${install}/${userId}/workout`;

// Midnight republish comes from the publisher's per-person day-end timer.
export function workoutProvider(
  database: Database,
  clock: { now(): Date },
): Provider {
  const install = selectInstallId(database)?.id ?? "";
  if (!install) throw new Error("Install id missing");
  return (person) => {
    const topic = workoutTopic(install, person.id);
    const schedule = readSchedule(database, person.id);
    const today = schedule
      ? resolveToday(
          schedule,
          localDay(
            clock.now().toISOString(),
            person.timezone,
            person.day_start_hour,
          ),
        )
      : null;
    return {
      entities: [
        {
          component: "sensor",
          key: "workout_today",
          config: {
            name: "Workout today",
            icon: "mdi:dumbbell",
            state_topic: topic,
            value_template: "{{ value_json.state }}",
            json_attributes_topic: topic,
            json_attributes_template:
              "{{ {'today': value_json.today, 'week': value_json.week} | tojson }}",
          },
        },
      ],
      state: {
        [topic]: JSON.stringify({
          state: today?.name ?? "No schedule",
          today,
          week: schedule?.week ?? null,
        }),
      },
    };
  };
}
