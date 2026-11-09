import type { Database } from "better-sqlite3";
import { writeTransaction } from "../db.ts";
import { localDay } from "../logging/day.ts";
import { commitCalendarCache } from "../queries/calendar/commit-calendar-cache.ts";
import { pruneCalendarCache } from "../queries/calendar/prune-calendar-cache.ts";
import { selectCalendarOwners } from "../queries/calendar/select-calendar-owners.ts";
import { selectCalendarRules } from "../queries/calendar/select-calendar-rules.ts";
import { selectCalendarSettings } from "../queries/calendar/select-calendar-settings.ts";
import { selectPerson } from "../queries/select-person.ts";
import { createCalendarEvaluator } from "./index.ts";
import type { CalendarTransport } from "./transport.ts";

export type CalendarRefresher = ReturnType<typeof createCalendarRefresher>;
export function createCalendarRefresher({
  database,
  clock,
  transport,
  evaluator = createCalendarEvaluator({ concurrency: 2 }),
  onChanged,
}: {
  database: Database;
  clock: { now(): Date };
  transport: CalendarTransport;
  evaluator?: ReturnType<typeof createCalendarEvaluator>;
  onChanged?: () => void;
}) {
  const queued = new Set<number>();
  const running = new Map<
    number,
    { controller: AbortController; dirty: boolean; promise: Promise<unknown> }
  >();
  let stopped = false;
  let stopping: Promise<void> | undefined;
  async function refresh(user_id: number, signal: AbortSignal) {
    const key = { user_id };
    const settings = selectCalendarSettings(database, key);
    const person = selectPerson(database, { id: user_id });
    if (!settings?.enabled || !settings.feed_url || !person) return;
    const fetched_at = clock.now().toISOString();
    const day = localDay(fetched_at, person.timezone, person.day_start_hour);
    const rules = selectCalendarRules(database, key);
    let result: Awaited<ReturnType<typeof evaluator.evaluate>> = {
      status: "unavailable",
    };
    try {
      const feed_text = await transport(settings.feed_url, signal);
      if (feed_text !== null && !signal.aborted)
        result = await evaluator.evaluate({
          feed_text,
          day,
          timezone: person.timezone,
          day_start_hour: person.day_start_hour,
          keywords: rules.map((item) => item.keyword),
        });
    } catch {
      result = { status: "unavailable" };
    }
    if (signal.aborted) return;
    const committed = writeTransaction(database, () => {
      const current = selectCalendarSettings(database, key);
      const owner = selectPerson(database, { id: user_id });
      if (
        !current?.enabled ||
        current.revision !== settings.revision ||
        !owner ||
        owner.timezone !== person.timezone ||
        owner.day_start_hour !== person.day_start_hour ||
        localDay(
          clock.now().toISOString(),
          owner.timezone,
          owner.day_start_hour,
        ) !== day
      )
        return false;
      const day_type_id =
        result.status === "match"
          ? rules[result.rule_index]?.day_type_id
          : null;
      commitCalendarCache(database, {
        ...key,
        day,
        timezone: person.timezone,
        day_start_hour: person.day_start_hour,
        revision: settings.revision,
        fetched_at,
        status:
          result.status === "match" && !day_type_id
            ? "unavailable"
            : result.status,
        day_type_id: day_type_id ?? null,
      });
      pruneCalendarCache(database, { ...key, day });
      return true;
    });
    if (committed) onChanged?.();
  }
  function drain() {
    while (!stopped && running.size < 2 && queued.size) {
      const user_id = queued.values().next().value;
      if (user_id === undefined) break;
      queued.delete(user_id);
      const task = {
        controller: new AbortController(),
        dirty: false,
        promise: Promise.resolve<unknown>(undefined),
      };
      running.set(user_id, task);
      task.promise = Promise.resolve()
        .then(() => refresh(user_id, task.controller.signal))
        .catch(() => console.error("calendar_refresh_failed"))
        .finally(() => {
          running.delete(user_id);
          if (task.dirty && !stopped) queued.add(user_id);
          drain();
        });
    }
  }
  function enqueue(user_id: number) {
    if (stopped) return "stopped";
    const task = running.get(user_id);
    if (task) task.dirty = true;
    else queued.add(user_id);
    drain();
    return "queued";
  }
  function enqueueAll() {
    try {
      if (stopped) return "stopped";
      for (const row of selectCalendarOwners(database)) enqueue(row.user_id);
      return "calendar_queued";
    } catch {
      return "unavailable";
    }
  }
  return {
    enqueue,
    start: enqueueAll,
    job: {
      name: "calendar-refresh",
      schedule: "0 * * * *",
      run: () => enqueueAll(),
    },
    stop() {
      if (!stopping) {
        stopped = true;
        queued.clear();
        for (const task of running.values()) task.controller.abort();
        stopping = Promise.all(
          [...running.values()].map((task) => task.promise),
        ).then(() => evaluator.close());
      }
      return stopping;
    },
  };
}
