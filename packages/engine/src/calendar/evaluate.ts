import ical from "node-ical";
import { type CalendarResult, calendarInput } from "./contract.ts";
import { rebuildStart, withinUntil } from "./occurrence.ts";
import { type CalendarSource, componentKey, scanCalendar } from "./scan.ts";
import {
  calendarDayMs,
  personDayBounds,
  supportedZone,
  wallInstant,
  wallTime,
} from "./time.ts";

function endInstant(source: CalendarSource, wallEnd: Date, start: Date): Date {
  const zone = source.start.zone;
  if (source.start.form === "date") return wallInstant(wallEnd, zone);
  if (source.duration) {
    const calendarEnd = new Date(
      wallTime(start, zone).getTime() + source.duration.days * calendarDayMs,
    );
    return new Date(
      wallInstant(calendarEnd, zone).getTime() + source.duration.milliseconds,
    );
  }
  if (!source.end) return start;
  if (source.recurring) {
    const duration =
      wallInstant(source.end.wall, source.end.zone).getTime() -
      wallInstant(source.start.wall, zone).getTime();
    return new Date(start.getTime() + duration);
  }
  return wallInstant(source.end.wall, source.end.zone);
}

export function evaluateCalendar(input: unknown): CalendarResult {
  try {
    const parsed = calendarInput.parse(input);
    if (Buffer.byteLength(parsed.feed_text) > 1_000_000)
      return { status: "unavailable" };
    const zone = supportedZone(parsed.timezone);
    const bounds = personDayBounds(parsed.day, zone, parsed.day_start_hour);
    const { sources, events } = scanCalendar(parsed.feed_text, zone);
    const from = new Date(bounds.start.getTime() - calendarDayMs);
    const to = new Date(bounds.end.getTime() + calendarDayMs);
    let total = 0;
    let ruleIndex = parsed.keywords.length;
    for (const event of Object.values(events)) {
      if (event?.type !== "VEVENT") continue;
      const master = sources.get(componentKey(event));
      if (!master) throw new Error("missing_source");
      const instances = ical.expandRecurringEvent(event, {
        from,
        to,
        expandOngoing: true,
        includeOverrides: true,
        excludeExdates: true,
      });
      total += instances.length;
      if (instances.length > 1000 || total > 10_000)
        return { status: "unavailable" };
      for (const instance of instances) {
        const source = sources.get(componentKey(instance.event));
        if (!source) throw new Error("missing_source");
        if (
          instance.event.status === "CANCELLED" ||
          event.status === "CANCELLED"
        )
          continue;
        const start = rebuildStart(
          source,
          instance.start,
          instance.isRecurring && !instance.isOverride,
        );
        if (!start || !withinUntil(source, master, instance.start)) continue;
        const end = endInstant(source, instance.end, start);
        if (!(start < bounds.end && end > bounds.start)) continue;
        const summary =
          typeof instance.summary === "string"
            ? instance.summary
            : instance.summary?.val;
        const words = new Set(
          (summary ?? "").toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [],
        );
        const match = parsed.keywords.findIndex((keyword) =>
          words.has(keyword.toLowerCase()),
        );
        if (match >= 0) ruleIndex = Math.min(ruleIndex, match);
      }
    }
    return ruleIndex < parsed.keywords.length
      ? { status: "match", rule_index: ruleIndex }
      : { status: "no_match" };
  } catch {
    return { status: "unavailable" };
  }
}
