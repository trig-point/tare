import type { Database } from "better-sqlite3";
import { listTargetNoticesAfter } from "../queries/home-assistant/list-target-notices-after.ts";
import { selectLastTargetNotice } from "../queries/home-assistant/select-last-target-notice.ts";
import type { Provider } from "./discovery.ts";

/** Fires one `target_changed` event per stored target notice, so the event and the in-app notice share one decision. */
export function targetEventProvider(database: Database): Provider {
  // Notices from before startup were already shown in the app; firing them again would be stale.
  const startId = selectLastTargetNotice(database)?.id ?? 0;
  const delivered = new Map<number, number>();
  return (person, topics) => ({
    entities: [
      {
        component: "event",
        key: "target_changed",
        config: {
          name: "Target changed",
          state_topic: topics.events,
          event_types: ["target_changed"],
        },
      },
    ],
    state: {},
    events: listTargetNoticesAfter(database, {
      user_id: person.id,
      after_id: delivered.get(person.id) ?? startId,
    }).map(({ id, ...notice }) => ({
      topic: topics.events,
      payload: JSON.stringify({ event_type: "target_changed", ...notice }),
      sent: () => delivered.set(person.id, id),
    })),
  });
}
