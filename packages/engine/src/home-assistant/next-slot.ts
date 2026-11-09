import type { Database } from "better-sqlite3";
import { supportedZone, wallInstant } from "../calendar/time.ts";
import type { Config } from "../config.ts";
import { nextSlot } from "../plan/operations.ts";
import { minuteOfDay } from "../plan/slots.ts";
import { selectInstallId } from "../queries/home-assistant/select-install-id.ts";
import type { Person, Provider } from "./discovery.ts";

export const nextSlotTopic = (install: string, userId: number) =>
  `tare/${install}/${userId}/next_slot`;

export function nextSlotProvider(
  database: Database,
  clock: { now(): Date },
  settings: Pick<Config, "tdee" | "activityCredit" | "activityBonusCap">,
): Provider {
  const install = selectInstallId(database)?.id ?? "";
  if (!install) throw new Error("Install id missing");
  return (person) => {
    const now = clock.now();
    const { day, slot, last } = nextSlot(database, person, now, settings);
    const topic = nextSlotTopic(install, person.id);
    const remaining = slot?.kcal.remaining ?? null;
    const refreshAt =
      slot && slot.position !== last
        ? slotEnd(person, day, slot.window_end, now)
        : undefined;
    return {
      entities: [
        {
          component: "sensor",
          key: "next_slot",
          config: {
            name: "Next slot remaining",
            state_topic: topic,
            value_template: "{{ value_json.remaining }}",
            unit_of_measurement: "kcal",
            suggested_display_precision: 0,
            json_attributes_topic: topic,
            json_attributes_template:
              "{{ {'slot': value_json.slot, 'budget': value_json.budget} | tojson }}",
          },
        },
      ],
      state: {
        [topic]: JSON.stringify({
          remaining: remaining === null ? null : Math.round(remaining),
          slot: slot?.name ?? null,
          budget: slot?.kcal.budget ?? null,
        }),
      },
      refreshAt,
    };
  };
}

// On a fall-back day a slot end inside the repeated hour resolves to its first pass; once that is
// behind us, whole minutes from now land on the second pass and never re-fire at once.
function slotEnd(person: Person, day: string, windowEnd: number, now: Date) {
  const wall = new Date(`${day}T00:00:00.000Z`);
  wall.setUTCMinutes(person.day_start_hour * 60 + windowEnd);
  const end = wallInstant(wall, supportedZone(person.timezone), "boundary");
  if (end > now) return end;
  const minutesLeft = windowEnd - minuteOfDay(now.toISOString(), person);
  return new Date(
    now.getTime() - (now.getTime() % 60_000) + minutesLeft * 60_000,
  );
}
