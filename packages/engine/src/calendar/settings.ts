import type { Database } from "better-sqlite3";
import type { Person } from "../auth/middleware.ts";
import { localDay } from "../logging/day.ts";
import { selectCalendarCache } from "../queries/calendar/select-calendar-cache.ts";
import { selectCalendarRules } from "../queries/calendar/select-calendar-rules.ts";
import { selectCalendarSettings } from "../queries/calendar/select-calendar-settings.ts";

export function readCalendarSettings(
  database: Database,
  person: Person,
  now: Date,
) {
  const key = { user_id: person.id };
  const settings = selectCalendarSettings(database, key);
  const configured = settings?.enabled === 1;
  const cached = configured
    ? selectCalendarCache(database, {
        ...key,
        day: localDay(
          now.toISOString(),
          person.timezone,
          person.day_start_hour,
        ),
        timezone: person.timezone,
        day_start_hour: person.day_start_hour,
        revision: settings.revision,
      })
    : null;
  const fresh =
    cached &&
    Date.parse(cached.fetched_at) <= now.getTime() &&
    Date.parse(cached.fetched_at) > now.getTime() - 3_600_000;
  return {
    configured,
    rules: selectCalendarRules(database, key),
    status: !configured ? "not_configured" : fresh ? cached.status : "pending",
    ...(cached ? { checked_at: cached.fetched_at } : {}),
    ...(fresh && cached.status === "match"
      ? { day_type_id: cached.day_type_id }
      : {}),
  };
}
