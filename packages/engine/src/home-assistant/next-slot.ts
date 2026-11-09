import type { Database } from "better-sqlite3";
import type { Config } from "../config.ts";
import { nextSlot } from "../plan/operations.ts";
import { minuteOfDay } from "../plan/slots.ts";
import { selectInstallId } from "../queries/home-assistant/select-install-id.ts";
import type { Provider } from "./discovery.ts";

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
    const { slot, last } = nextSlot(database, person, now, settings);
    const topic = nextSlotTopic(install, person.id);
    const remaining = slot?.kcal.remaining ?? null;
    const minutesLeft =
      slot && slot.position !== last
        ? slot.window_end - minuteOfDay(now.toISOString(), person)
        : null;
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
      // Slot ends fall on whole local minutes, which every IANA zone keeps aligned with UTC minutes.
      refreshAt:
        minutesLeft === null
          ? undefined
          : new Date(
              now.getTime() - (now.getTime() % 60_000) + minutesLeft * 60_000,
            ),
    };
  };
}
