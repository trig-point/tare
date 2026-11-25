import type { Database } from "better-sqlite3";
import { listActivityEventsAfter } from "../queries/home-assistant/list-activity-events-after.ts";
import { selectLastActivityEvent } from "../queries/home-assistant/select-last-activity-event.ts";
import type { Provider } from "./discovery.ts";

const activityEventTypes = [
  "food_logged",
  "dose_logged",
  "weight_logged",
  "workout_logged",
];

/** Fires one event per food, dose, weight or workout logged since the engine started. */
export function activityEventProvider(database: Database): Provider {
  // Records from before startup are history, not news; replaying them after a restart would re-trigger automations.
  const startId = selectLastActivityEvent(database)?.id ?? 0;
  const delivered = new Map<number, number>();
  return (person, topics) => {
    // Its own topic: Home Assistant rejects an event type the entity does not list, and target_changed shares the base topic.
    const topic = `${topics.events}/activity`;
    return {
      entities: [
        {
          component: "event",
          key: "activity",
          config: {
            name: "Activity",
            state_topic: topic,
            event_types: activityEventTypes,
          },
        },
      ],
      state: {},
      events: listActivityEventsAfter(database, {
        user_id: person.id,
        after_id: delivered.get(person.id) ?? startId,
      }).map(({ id, payload }) => ({
        topic,
        payload,
        sent: () => delivered.set(person.id, id),
      })),
    };
  };
}
