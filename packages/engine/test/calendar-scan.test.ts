import assert, {
  deepEqual,
  doesNotThrow,
  equal,
  throws,
} from "node:assert/strict";
import { test } from "node:test";
import ICAL from "ical.js";
import ical from "node-ical";
import { rebuildStart, withinUntil } from "../src/calendar/occurrence.ts";
import { componentKey, scanCalendar } from "../src/calendar/scan.ts";
import {
  personDayBounds,
  supportedZone,
  wallInstant,
  wallTime,
} from "../src/calendar/time.ts";
import { windowsZones } from "../src/calendar/windows-zones.ts";
import { localDay } from "../src/logging/day.ts";

process.env.TZ = "UTC";
const instants = (values: string) =>
  values.split(" ").map((value) => new Date(value).toISOString());
const feed = (parts: TemplateStringsArray, ...values: string[]) => {
  const text = String.raw({ raw: parts }, ...values);
  const events = text
    ? text.split("~").map((fields) => `BEGIN:VEVENT|${fields}|END:VEVENT`)
    : [];
  return ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"]
    .join("|")
    .replaceAll("|", "\r\n");
};
function starts(
  text: string,
  zone = "UTC",
  from = "2000-01-01",
  to = "2028-01-01",
) {
  const { events, sources } = scanCalendar(text, zone);
  const result: string[] = [];
  for (const master of Object.values(events)) {
    if (master?.type !== "VEVENT") continue;
    const masterSource = sources.get(componentKey(master));
    assert(masterSource);
    for (const instance of ical.expandRecurringEvent(master, {
      from: new Date(from),
      to: new Date(to),
      includeOverrides: true,
      excludeExdates: true,
      expandOngoing: false,
    })) {
      const source = sources.get(componentKey(instance.event));
      assert(source);
      const rebuilt = rebuildStart(
        source,
        instance.start,
        instance.isRecurring && !instance.isOverride,
      );
      if (rebuilt && withinUntil(source, masterSource, instance.start))
        result.push(rebuilt.toISOString());
    }
  }
  return result;
}
function recurrence(name: string, expected: string, zone = "UTC") {
  return (parts: TemplateStringsArray, ...values: string[]) => {
    const text = feed(parts, ...values);
    test(name, () => deepEqual(starts(text, zone).sort(), instants(expected)));
  };
}
test("person days follow local labels through DST gaps and folds", () => {
  for (const [day, zone, hour, hours] of [
    ["2027-01-05", "Asia/Tokyo", 4, 24],
    ["2027-03-14", "America/New_York", 0, 23],
    ["2027-11-07", "America/New_York", 0, 25],
    ["2027-03-28", "Europe/Berlin", 2, 23],
    ["2027-10-31", "Europe/Berlin", 2, 25],
  ] as const) {
    const { start, end } = personDayBounds(day, zone, hour);
    equal((end.getTime() - start.getTime()) / 3_600_000, hours);
    const label = (instant: number) =>
      localDay(new Date(instant).toISOString(), zone, hour);
    deepEqual([label(start.getTime()), label(end.getTime() - 1)], [day, day]);
    assert.notEqual(label(start.getTime() - 1), day);
    assert.notEqual(label(end.getTime()), day);
  }
  equal(
    personDayBounds("2027-10-31", "Europe/Berlin", 2).start.toISOString(),
    "2027-10-31T00:00:00.000Z",
  );
  throws(() => personDayBounds("2027-02-30", "UTC", 4));
  throws(() => personDayBounds("2027-01-01", "UTC", 24));
});
test("CLDR 48 Windows zones resolve except offset names, with continent samples", () => {
  const sample = new Date("2027-01-05T09:00Z");
  for (const name of Object.keys(windowsZones))
    if (/^UTC[+-]\d{2}$/.test(name))
      throws(() => supportedZone(name), /unsupported_timezone/);
    else doesNotThrow(() => supportedZone(name));
  for (const [name, expected] of [
    ["Pacific Standard Time", "2027-01-05T17:00Z"],
    ["SA Eastern Standard Time", "2027-01-05T12:00Z"],
    ["W. Europe Standard Time", "2027-01-05T08:00Z"],
    ["South Africa Standard Time", "2027-01-05T07:00Z"],
    ["Tokyo Standard Time", "2027-01-05T00:00Z"],
    ["AUS Eastern Standard Time", "2027-01-04T22:00Z"],
  ] as const) {
    const actual = wallInstant(sample, supportedZone(name));
    equal(actual.toISOString(), new Date(expected).toISOString());
  }
});
test("scanner strips VTIMEZONE and preserves each source form and folded value", () => {
  const text =
    feed`UID:floating|DTSTART;VALUE=DATE-TIME:20270105T\r\n 090000|DURATION:+PT1H|SUMMARY;VALUE=TEXT:Bring a 12" ruler~UID:zoned|DTSTART;TZID="Eastern Standard Time":20270105T090000~UID:date|DTSTART;VALUE=DATE:20270105|DTEND;VALUE=DATE:20270107~UID:utc|DTSTART:20270105T090000Z~UID:utc-zone|DTSTART;TZID=UTC:20270105T090000~UID:etc-zone|DTSTART;TZID=Etc/UTC:20270105T090000`
      .replace(
        "VERSION:2.0",
        "VERSION:2.0\r\nBEGIN:VTIMEZONE\r\nTZID:America/New_York\r\nBEGIN:STANDARD\r\nDTSTART:20261101T020000\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\nEND:STANDARD\r\nEND:VTIMEZONE",
      )
      .replace("END:VCALENDAR", 'X-WR-CALDESC:Room 5" wide\r\nend:vcalendar');
  const { events, sources } = scanCalendar(text, "Asia/Tokyo");
  deepEqual(
    [...sources.values()].map((source) => source.start.form),
    ["floating", "zoned", "date", "utc", "zoned", "zoned"],
  );
  assert(
    !Object.values(events).some((component) => component?.type === "VTIMEZONE"),
  );
  const floating = events.floating;
  assert(floating?.type === "VEVENT");
  equal(floating.summary, 'Bring a 12" ruler');
  deepEqual(
    starts(text, "Asia/Tokyo"),
    instants(
      "2027-01-05T00:00Z 2027-01-05T14:00Z 2027-01-04T15:00Z 2027-01-05T09:00Z 2027-01-05T09:00Z 2027-01-05T09:00Z",
    ),
  );
});
recurrence(
  "zoned recurrences keep local time across DST",
  "2027-03-07T14:00Z 2027-03-14T13:00Z",
)`UID:series|DTSTART;TZID=America/New_York:20270307T090000|RRULE:FREQ=WEEKLY;COUNT=2`;
recurrence(
  "an autumn fold chooses the earlier instant",
  "2026-11-01T08:30Z",
)`UID:series|DTSTART;TZID=America/Los_Angeles:20261101T013000`;
recurrence(
  "generated timed instances in a DST gap are omitted",
  "2027-03-21T01:30Z 2027-04-04T00:30Z",
)`UID:series|DTSTART;TZID=Europe/Berlin:20270321T023000|RRULE:FREQ=WEEKLY;COUNT=3`;
test("explicit wall times in a gap shift forward", () => {
  const shifted = wallInstant(new Date("2027-03-28T02:30Z"), "Europe/Berlin");
  deepEqual(
    [shifted.toISOString(), wallTime(shifted, "Europe/Berlin").toISOString()],
    instants("2027-03-28T01:30Z 2027-03-28T03:30Z"),
  );
});
recurrence(
  "UTC exceptions join a zoned series and retain the moved override zone",
  "2027-01-01T14:00Z 2027-01-05T15:30Z",
)`UID:series|DTSTART;TZID=America/New_York:20270101T090000|RRULE:FREQ=DAILY;COUNT=3|EXDATE:20270103T140000Z~UID:series|RECURRENCE-ID:20270102T140000Z|DTSTART;TZID=Asia/Tokyo:20270106T003000`;
recurrence(
  "floating exceptions join a floating series with a zoned override",
  "2027-01-01T09:00Z 2027-01-06T00:00Z",
)`UID:series|DTSTART:20270101T090000|RRULE:FREQ=DAILY;COUNT=2~UID:series|RECURRENCE-ID:20270102T090000|DTSTART;TZID=Asia/Tokyo:20270106T090000`;
test("UNTIL compares original instants and keeps the final moved occurrence", () => {
  for (const zone of ["America/New_York", "Asia/Tokyo"]) {
    const until =
      zone === "Asia/Tokyo" ? "20270103T000000Z" : "20270103T140000Z";
    const values = starts(
      feed`UID:series|DTSTART;TZID=${zone}:20270101T090000|RRULE:FREQ=DAILY;UNTIL=${until}~UID:series|RECURRENCE-ID;TZID=${zone}:20270103T090000|DTSTART;TZID=${zone}:20270106T090000`,
    );
    deepEqual(
      values.map((value) => value.slice(0, 10)),
      ["2027-01-01", "2027-01-02", "2027-01-06"],
    );
  }
});
recurrence(
  "UNTIL includes the final autumn fold",
  "2027-10-31T05:30Z 2027-11-07T05:30Z",
)`UID:series|DTSTART;TZID=America/New_York:20271031T013000|RRULE:FREQ=WEEKLY;UNTIL=20271107T053000Z`;
test("DATE exceptions and recurrence bounds use calendar dates in east and west zones", () => {
  const master =
    "UID:series|DTSTART;VALUE=DATE:20270101|RRULE:FREQ=DAILY;UNTIL=20270110|EXDATE;VALUE=DATE:20270102";
  for (const zone of ["America/Los_Angeles", "Asia/Tokyo"]) {
    const dates = (text: string, from = "2027-01-01") =>
      starts(text, zone, from, "2027-01-14").map((value) =>
        wallTime(new Date(value), zone).toISOString().slice(0, 10),
      );
    deepEqual(
      dates(
        feed`${master}~UID:series|RECURRENCE-ID;VALUE=DATE:20270110|DTSTART;VALUE=DATE:20270112`,
      ),
      "2027-01-01 2027-01-03 2027-01-04 2027-01-05 2027-01-06 2027-01-07 2027-01-08 2027-01-09 2027-01-12".split(
        " ",
      ),
    );
    deepEqual(dates(feed`${master}`, "2027-01-10"), ["2027-01-10"]);
  }
});
recurrence(
  "Outlook all-day UNTIL includes the final weekly date",
  "2009-02-13T08:00Z 2009-02-20T08:00Z 2009-02-27T08:00Z 2009-03-06T08:00Z",
  "America/Los_Angeles",
)`UID:series|DTSTART;VALUE=DATE:20090213|RRULE:FREQ=WEEKLY;UNTIL=20090306T000000Z;BYDAY=FR`;
recurrence(
  "Outlook all-day UNTIL normalizes a non-midnight UTC cutoff",
  "2026-10-20T07:00Z",
  "America/Los_Angeles",
)`UID:series|DTSTART;VALUE=DATE:20261020|RRULE:FREQ=DAILY;UNTIL=20261019T230000Z`;
test("unsupported and malformed feeds fail closed", (context) => {
  const input = "UID:input|DTSTART:20270105T090000Z";
  const valid = feed`${input}`;
  const nested = feed``.replace(
    "END:VCALENDAR",
    `${"BEGIN:VTODO\r\n".repeat(80_000)}${"END:VTODO\r\n".repeat(80_000)}END:VCALENDAR`,
  );
  const parser = context.mock.method(ICAL, "parse");
  for (const text of [
    "",
    "BEGIN:VCALENDAR",
    feed`UID:missing`,
    valid
      .replace("BEGIN:VEVENT", "BEGIN:VTODO\r\nBEGIN:VEVENT")
      .replace("END:VEVENT", "END:VEVENT\r\nEND:VTODO"),
    `${feed``}\r\n${feed``}`,
    valid.replace("END:VEVENT", "END:VTODO"),
    feed`UID;VALUE=URI:https://example.test/event|DTSTART:20270105T090000Z`,
    feed`UID:input|DTSTART;VALUE=DATE:20270101|RRULE:FREQ=DAILY;UNTIL=20270103BOGUS`,
    valid.replace(
      "END:VCALENDAR",
      "X-AT;TZID=Unlisted/Office:20270105T090000\r\nEND:VCALENDAR",
    ),
    feed`UID:input|DTSTART:20270230T090000`,
    feed`UID:input|DTSTART;TZID=:20270105T090000`,
    feed`UID:input|DTSTART;TZID=Unlisted/Office;TZID=UTC:20270105T090000`,
    feed`UID:input|DTSTART;TZID=Asia/Tokyo:20270105T090000Z`,
    feed`UID:input|DTSTART;VALUE=DATE;TZID=Asia/Tokyo:20270105`,
    feed`UID:input|DTSTART;VALUE=TEXT:20270105T090000Z`,
    feed`${input}|BEGIN:VEVENT|END:VEVENT`,
    feed`${input}|UID:duplicate`,
    feed`${input}|DTSTART:20270106T090000Z`,
    feed`${input}|RRULE:FREQ=DAILY|RRULE:FREQ=WEEKLY`,
    feed`${input}|RECURRENCE-ID;RANGE=THISANDFUTURE:20270106T090000Z`,
    feed`${input}|RECURRENCE-ID:20270106T090000Z|RRULE:FREQ=DAILY`,
    feed`${input}|DTEND:20270105T100000Z,20270105T110000Z`,
    feed`${input}|RDATE:20270106T090000Z`,
    feed`${input}|BEGIN:VALARM|DTSTAMP;TZID=Unlisted/Office:20270105T090000|END:VALARM`,
    feed`${input}|RRULE:FREQ=DAILY;COUNT=abc`,
    feed`${input}|RRULE:FREQ=DAILY;COUNT=2junk`,
    feed`${input}|RRULE:FREQ=DAILY;INTERVAL=0`,
    feed`${input}|RRULE:FREQ=DAILY;BYHOUR=25`,
    feed`UID:series|DTSTART:20270101T090000|RRULE:FREQ=DAILY;COUNT=2~UID:series|RECURRENCE-ID;TZID=Asia/Tokyo:20270102T090000|DTSTART:20270106T120000`,
    feed`UID:bad|DTSTART;TZID="Customized Time Zone":20270105T090000`,
    feed`${input}|EXDATE;TZID=Unlisted/Office:20270105T090000`,
    feed`${input}|RECURRENCE-ID;TZID="tzone://Microsoft/Custom":20270105T090000`,
    feed`UID:bad|DTSTART;TZID="+05:30":20270105T090000`,
    feed`${input}|EXDATE;TZID=UTC-03:20270105T090000`,
    nested,
  ]) {
    parser.mock.resetCalls();
    throws(() => scanCalendar(text, "UTC"), Error, text);
    if (text === nested) equal(parser.mock.callCount(), 0);
  }
  throws(() => scanCalendar(valid, "+05:30"), /unsupported_timezone/);
  equal(scanCalendar(feed``, "UTC").sources.size, 0);
  process.env.TZ = "Asia/Tokyo";
  try {
    throws(() => scanCalendar(valid, "UTC"), /process_timezone_not_utc/);
  } finally {
    process.env.TZ = "UTC";
  }
});
recurrence(
  "recurrence positions survive a lowercase UNTIL",
  "2027-01-01T00:00Z 2027-01-02T00:00Z 2027-01-03T00:00Z",
)`UID:series|DTSTART;TZID=Asia/Tokyo:20270101T090000|RRULE:FREQ=DAILY;until=20270103T000000Z`;
recurrence(
  "recurrence positions survive COUNT before FREQ",
  "2027-01-01T09:00Z 2027-01-02T09:00Z",
)`UID:series|DTSTART:20270101T090000Z|RRULE:COUNT=2;FREQ=DAILY`;
recurrence(
  "recurrence positions survive a DATE UNTIL on a timed series",
  "2027-01-08T14:00Z 2027-01-09T14:00Z 2027-01-10T14:00Z",
)`UID:series|DTSTART;TZID=America/New_York:20270108T090000|RRULE:FREQ=DAILY;UNTIL=20270110`;
recurrence(
  "recurrence positions survive an all-day series over a skipped midnight",
  "2026-09-04T04:00Z 2026-09-05T04:00Z 2026-09-06T04:00Z 2026-09-07T03:00Z",
  "America/Santiago",
)`UID:series|DTSTART;VALUE=DATE:20260904|RRULE:FREQ=DAILY;COUNT=4`;
recurrence(
  "recurrence positions survive a timed override of an all-day series",
  "2027-01-01T00:00Z 2027-01-02T14:00Z 2027-01-03T00:00Z",
)`UID:series|DTSTART;VALUE=DATE:20270101|RRULE:FREQ=DAILY;COUNT=3~UID:series|RECURRENCE-ID;VALUE=DATE:20270102|DTSTART:20270102T140000Z`;
test("parameterized UIDs keep distinct events", () => {
  const { events } = scanCalendar(
    feed`UID;X-SOURCE=example:one|DTSTART:20270105T090000Z~UID;X-SOURCE=example:two|DTSTART:20270105T100000Z`,
    "UTC",
  );
  equal(
    Object.values(events).filter((entry) => entry?.type === "VEVENT").length,
    2,
  );
});
recurrence(
  "quoted parameters cannot change recurrence value types",
  "2027-01-05T09:00Z 2027-01-06T09:00Z",
)`UID:series|DTSTART;X-LABEL="a;VALUE=DATE;X=b":20270105T090000Z|RRULE:FREQ=DAILY;COUNT=2`;
test("canonicalization is idempotent", (context) => {
  let canonical = "";
  const parse = ical.sync.parseICS;
  context.mock.method(ical.sync, "parseICS", (text: string) => {
    canonical = text;
    return parse(text);
  });
  scanCalendar(
    feed`UID:series|DTSTART;TZID=Asia/Tokyo:20270101T090000|RRULE:FREQ=DAILY;UNTIL=20270103T000000Z|EXDATE:20270102T000000Z`,
    "Europe/Berlin",
  );
  const canonical1 = canonical;
  const first = scanCalendar(canonical1, "Europe/Berlin");
  const canonical2 = canonical;
  const second = scanCalendar(canonical2, "Europe/Berlin");
  equal(canonical2, canonical1);
  deepEqual(second.sources, first.sources);
});
