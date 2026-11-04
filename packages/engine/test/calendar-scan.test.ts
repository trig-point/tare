import assert from "node:assert/strict";
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

const instants = (values: string) =>
  values.split(" ").map((value) => new Date(value).toISOString());

process.env.TZ = "UTC";
const event = (...lines: string[]) =>
  ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
const calendar = (...components: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...components, "END:VCALENDAR"].join(
    "\r\n",
  );
const series = (start: string, rule: string, ...lines: string[]) =>
  event("UID:series", start, `RRULE:${rule}`, ...lines);
function starts(feed: string, zone: string, from: string, to: string) {
  const { events, sources } = scanCalendar(feed, zone);
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

test("person days follow local labels through DST gaps and folds", () => {
  for (const [day, zone, hour, hours] of [
    ["2027-01-05", "Asia/Tokyo", 4, 24],
    ["2027-03-14", "America/New_York", 0, 23],
    ["2027-11-07", "America/New_York", 0, 25],
    ["2027-03-28", "Europe/Berlin", 2, 23],
    ["2027-10-31", "Europe/Berlin", 2, 25],
  ] as const) {
    const { start, end } = personDayBounds(day, zone, hour);
    assert.equal((end.getTime() - start.getTime()) / 3_600_000, hours);
    const label = (instant: number) =>
      localDay(new Date(instant).toISOString(), zone, hour);
    assert.equal(label(start.getTime()), day);
    assert.notEqual(label(start.getTime() - 1), day);
    assert.equal(label(end.getTime() - 1), day);
    assert.notEqual(label(end.getTime()), day);
  }
  assert.equal(
    personDayBounds("2027-10-31", "Europe/Berlin", 2).start.toISOString(),
    "2027-10-31T00:00:00.000Z",
  );
  assert.throws(() => personDayBounds("2027-02-30", "UTC", 4));
  assert.throws(() => personDayBounds("2027-01-01", "UTC", 24));
});

test("CLDR 48 Windows zones resolve except offset names, with continent samples", () => {
  const entries = Object.entries(windowsZones);
  const offsetNames = entries.filter(([name]) => /^UTC[+-]\d{2}$/.test(name));
  for (const [name] of entries)
    if (offsetNames.some(([offsetName]) => offsetName === name))
      assert.throws(() => supportedZone(name), /unsupported_timezone/);
    else assert.doesNotThrow(() => supportedZone(name));
  const sample = new Date("2027-01-05T09:00Z");
  for (const [name, expected] of [
    ["Pacific Standard Time", "2027-01-05T17:00:00.000Z"],
    ["SA Eastern Standard Time", "2027-01-05T12:00:00.000Z"],
    ["W. Europe Standard Time", "2027-01-05T08:00:00.000Z"],
    ["South Africa Standard Time", "2027-01-05T07:00:00.000Z"],
    ["Tokyo Standard Time", "2027-01-05T00:00:00.000Z"],
    ["AUS Eastern Standard Time", "2027-01-04T22:00:00.000Z"],
  ])
    assert.equal(
      wallInstant(sample, supportedZone(name as string)).toISOString(),
      expected,
    );
});

test("scanner strips VTIMEZONE and preserves each source form and folded value", () => {
  const zoneBlock = [
    "BEGIN:VTIMEZONE",
    "TZID:America/New_York",
    "BEGIN:STANDARD",
    "DTSTART:20261101T020000",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "END:STANDARD",
    "END:VTIMEZONE",
  ].join("\r\n");
  const feed = calendar(
    zoneBlock,
    event(
      "UID:floating",
      "DTSTART;VALUE=DATE-TIME:20270105T\r\n 090000",
      "DURATION:PT1H",
    ),
    event("UID:zoned", 'DTSTART;TZID="Eastern Standard Time":20270105T090000'),
    event(
      "UID:date",
      "DTSTART;VALUE=DATE:20270105",
      "DTEND;VALUE=DATE:20270107",
    ),
    event("UID:utc", "DTSTART:20270105T090000Z"),
  );
  const { events, sources } = scanCalendar(feed, "Asia/Tokyo");
  assert.deepEqual(
    [...sources.values()].map((source) => source.start.form),
    ["floating", "zoned", "date", "utc"],
  );
  assert.equal(
    Object.values(events).some((component) => component?.type === "VTIMEZONE"),
    false,
  );
  assert.deepEqual(
    starts(feed, "Asia/Tokyo", "2027-01-05", "2027-01-06"),
    instants(
      "2027-01-05T00:00Z 2027-01-05T14:00Z 2027-01-04T15:00Z 2027-01-05T09:00Z",
    ),
  );
  for (const name of [
    "America/New_York",
    "UTC",
    "Etc/UTC",
    "Eastern Standard Time",
  ])
    assert.doesNotThrow(() =>
      scanCalendar(
        calendar(
          event("UID:accepted", `DTSTART;TZID="${name}":20270105T090000`),
        ),
        "UTC",
      ),
    );
});

test("zoned recurrences keep local time across DST and use the earlier autumn fold", () => {
  const feed = calendar(
    series(
      "DTSTART;TZID=America/New_York:20270307T090000",
      "FREQ=WEEKLY;COUNT=2",
    ),
  );
  assert.deepEqual(
    starts(feed, "UTC", "2027-03-01", "2027-03-15"),
    instants("2027-03-07T14:00Z 2027-03-14T13:00Z"),
  );
  const folded = calendar(
    event("UID:fold", "DTSTART;TZID=America/Los_Angeles:20261101T013000"),
  );
  assert.deepEqual(starts(folded, "UTC", "2026-11-01", "2026-11-02"), [
    "2026-11-01T08:30:00.000Z",
  ]);
  const gap = calendar(
    series("DTSTART;TZID=Europe/Berlin:20270321T023000", "FREQ=WEEKLY;COUNT=3"),
  );
  assert.deepEqual(
    starts(gap, "UTC", "2027-03-20", "2027-04-05"),
    instants("2027-03-21T01:30Z 2027-04-04T00:30Z"),
  );
  const wall = new Date("2027-03-28T02:30Z");
  assert.equal(
    wallInstant(wall, "Europe/Berlin").toISOString(),
    "2027-03-28T01:30:00.000Z",
  );
  assert.equal(
    wallTime(wallInstant(wall, "Europe/Berlin"), "Europe/Berlin").toISOString(),
    "2027-03-28T03:30:00.000Z",
  );
});

test("UTC exceptions join a zoned series, and mixed-form overrides retain their zone", () => {
  const master = series(
    "DTSTART;TZID=America/New_York:20270101T090000",
    "FREQ=DAILY;COUNT=3",
    "EXDATE:20270103T140000Z",
  );
  const moved = event(
    "UID:series",
    "RECURRENCE-ID:20270102T140000Z",
    "DTSTART;TZID=Asia/Tokyo:20270106T003000",
  );
  assert.deepEqual(
    starts(calendar(master, moved), "UTC", "2027-01-01", "2027-01-07"),
    instants("2027-01-01T14:00Z 2027-01-05T15:30Z"),
  );
  const floating = series("DTSTART:20270101T090000", "FREQ=DAILY;COUNT=2");
  assert.throws(() =>
    scanCalendar(
      calendar(
        floating,
        event(
          "UID:series",
          "RECURRENCE-ID;TZID=Asia/Tokyo:20270102T090000",
          "DTSTART:20270106T120000",
        ),
      ),
      "UTC",
    ),
  );
  assert.deepEqual(
    starts(
      calendar(
        floating,
        event(
          "UID:series",
          "RECURRENCE-ID:20270102T090000",
          "DTSTART;TZID=Asia/Tokyo:20270106T090000",
        ),
      ),
      "UTC",
      "2027-01-01",
      "2027-01-07",
    ),
    instants("2027-01-01T09:00Z 2027-01-06T00:00Z"),
  );
});

test("UNTIL compares original instants and keeps the final moved occurrence", () => {
  for (const zone of ["America/New_York", "Asia/Tokyo"]) {
    const until =
      zone === "Asia/Tokyo" ? "20270103T000000Z" : "20270103T140000Z";
    const feed = calendar(
      series(
        `DTSTART;TZID=${zone}:20270101T090000`,
        `FREQ=DAILY;UNTIL=${until}`,
      ),
      event(
        "UID:series",
        `RECURRENCE-ID;TZID=${zone}:20270103T090000`,
        `DTSTART;TZID=${zone}:20270106T090000`,
      ),
    );
    const values = starts(feed, "UTC", "2027-01-01", "2027-01-08");
    assert.equal(values.length, 3);
    assert(values[2]?.startsWith("2027-01-06"));
    assert(
      !values.some(
        (value) =>
          value.startsWith("2027-01-03") || value.startsWith("2027-01-04"),
      ),
    );
  }
  const fold = calendar(
    series(
      "DTSTART;TZID=America/New_York:20271031T013000",
      "FREQ=WEEKLY;UNTIL=20271107T053000Z",
    ),
  );
  assert.equal(starts(fold, "UTC", "2027-10-30", "2027-11-15").length, 2);
});

test("DATE exceptions and recurrence bounds use calendar dates in east and west zones", () => {
  for (const zone of ["America/Los_Angeles", "Asia/Tokyo"]) {
    const master = series(
      "DTSTART;VALUE=DATE:20270101",
      "FREQ=DAILY;UNTIL=20270110",
      "EXDATE;VALUE=DATE:20270102",
    );
    const feed = calendar(
      master,
      event(
        "UID:series",
        "RECURRENCE-ID;VALUE=DATE:20270110",
        "DTSTART;VALUE=DATE:20270112",
      ),
    );
    const walls = starts(feed, zone, "2027-01-01", "2027-01-14").map((value) =>
      wallTime(new Date(value), zone).toISOString().slice(0, 10),
    );
    assert(walls.includes("2027-01-12"));
    for (const excluded of ["2027-01-02", "2027-01-10", "2027-01-11"])
      assert(!walls.includes(excluded));
    const ordinary = starts(
      calendar(master),
      zone,
      "2027-01-10",
      "2027-01-12",
    ).map((value) =>
      wallTime(new Date(value), zone).toISOString().slice(0, 10),
    );
    assert.deepEqual(ordinary, ["2027-01-10"]);
  }
});

test("all-day UNTIL reuses node-ical UTC normalization", () => {
  const feed = calendar(
    series(
      "DTSTART;VALUE=DATE:20090213",
      "FREQ=WEEKLY;UNTIL=20090306T000000Z;BYDAY=FR",
    ),
  );
  assert.deepEqual(
    starts(feed, "America/Los_Angeles", "2009-03-06", "2009-03-14"),
    ["2009-03-06T08:00:00.000Z"],
  );
  const offset = calendar(
    series("DTSTART;VALUE=DATE:20261020", "FREQ=DAILY;UNTIL=20261019T230000Z"),
  );
  assert.deepEqual(
    starts(offset, "America/Los_Angeles", "2026-10-20", "2026-10-22"),
    ["2026-10-20T07:00:00.000Z"],
  );
});

const untrusted = (...lines: string[]) =>
  calendar(event("UID:input", "DTSTART:20270105T090000Z", ...lines));
test("unsupported and malformed feeds fail closed", (context) => {
  const timed = (start: string) => calendar(event("UID:input", start));
  const cases = [
    "",
    "BEGIN:VCALENDAR",
    calendar(event("UID:missing")),
    calendar(
      "BEGIN:VTODO",
      event("UID:input", "DTSTART:20270105T090000Z"),
      "END:VTODO",
    ),
    `${calendar()}\r\n${calendar()}`,
    untrusted().replace("END:VEVENT", "END:VTODO"),
    untrusted().replace(
      "UID:input",
      "UID;VALUE=URI:https://example.test/event",
    ),
    calendar(
      series("DTSTART;VALUE=DATE:20270101", "FREQ=DAILY;UNTIL=20270103BOGUS"),
    ),
    calendar(
      event("UID:input", "DTSTART:20270105T090000Z"),
      "X-AT;TZID=Unlisted/Office:20270105T090000",
    ),
  ];
  for (const suffix of [
    ":20270230T090000",
    ";TZID=:20270105T090000",
    ";TZID=Unlisted/Office;TZID=UTC:20270105T090000",
    ";TZID=Asia/Tokyo:20270105T090000Z",
    ";VALUE=DATE;TZID=Asia/Tokyo:20270105",
    ";VALUE=TEXT:20270105T090000Z",
  ])
    cases.push(timed(`DTSTART${suffix}`));
  for (const fields of [
    ["BEGIN:VEVENT", "END:VEVENT"],
    ["UID:duplicate"],
    ["DTSTART:20270106T090000Z"],
    ["RRULE:FREQ=DAILY", "RRULE:FREQ=WEEKLY"],
    ["RECURRENCE-ID;RANGE=THISANDFUTURE:20270106T090000Z"],
    ["RECURRENCE-ID:20270106T090000Z", "RRULE:FREQ=DAILY"],
    ["DTEND:20270105T100000Z,20270105T110000Z"],
    ["RDATE:20270106T090000Z"],
    [
      "BEGIN:VALARM",
      "DTSTAMP;TZID=Unlisted/Office:20270105T090000",
      "END:VALARM",
    ],
  ])
    cases.push(untrusted(...fields));
  for (const rule of ["COUNT=abc", "COUNT=2junk", "INTERVAL=0", "BYHOUR=25"])
    cases.push(untrusted(`RRULE:FREQ=DAILY;${rule}`));
  for (const name of [
    "Customized Time Zone",
    "Unlisted/Office",
    "tzone://Microsoft/Custom",
    "+05:30",
    "UTC-03",
  ])
    for (const field of ["DTSTART", "EXDATE", "RECURRENCE-ID"])
      cases.push(
        calendar(
          event(
            "UID:bad",
            ...(field === "DTSTART" ? [] : ["DTSTART:20270105T090000Z"]),
            `${field};TZID="${name}":20270105T090000`,
          ),
        ),
      );
  for (const feed of cases)
    assert.throws(() => scanCalendar(feed, "UTC"), Error, feed);
  assert.throws(
    () => scanCalendar(untrusted(), "+05:30"),
    /unsupported_timezone/,
  );
  assert.equal(scanCalendar(calendar(), "UTC").sources.size, 0);
  process.env.TZ = "Asia/Tokyo";
  try {
    assert.throws(
      () => scanCalendar(untrusted(), "UTC"),
      /process_timezone_not_utc/,
    );
  } finally {
    process.env.TZ = "UTC";
  }
  const parser = context.mock.method(ICAL, "parse");
  const nested = calendar(
    "BEGIN:VTODO\r\n".repeat(80_000),
    "END:VTODO\r\n".repeat(80_000),
  );
  assert.throws(() => scanCalendar(nested, "UTC"), /invalid_calendar/);
  assert.equal(parser.mock.callCount(), 0);
});

test("free text, case and signed durations do not make a feed unavailable", () => {
  const feed = calendar(
    event(
      "UID:text",
      "DTSTART:20270105T090000Z",
      "DURATION:+PT1H",
      'SUMMARY;VALUE=TEXT:Bring a 12" ruler',
    ),
  )
    .replace("VERSION:2.0", 'VERSION:2.0\r\nX-WR-CALDESC:Room 5" wide')
    .replace("END:VCALENDAR", "end:vcalendar");
  const component = Object.values(scanCalendar(feed, "UTC").events).find(
    (entry) => entry?.type === "VEVENT",
  );
  assert.equal(component?.summary, 'Bring a 12" ruler');
});

for (const [name, feed, zone, expected] of [
  [
    "a lowercase UNTIL",
    calendar(
      series(
        "DTSTART;TZID=Asia/Tokyo:20270101T090000",
        "FREQ=DAILY;until=20270103T000000Z",
      ),
    ),
    "UTC",
    instants("2027-01-01T00:00Z 2027-01-02T00:00Z 2027-01-03T00:00Z"),
  ],
  [
    "COUNT before FREQ",
    calendar(series("DTSTART:20270101T090000Z", "COUNT=2;FREQ=DAILY")),
    "UTC",
    instants("2027-01-01T09:00Z 2027-01-02T09:00Z"),
  ],
  [
    "a DATE UNTIL on a timed series",
    calendar(
      series(
        "DTSTART;TZID=America/New_York:20270108T090000",
        "FREQ=DAILY;UNTIL=20270110",
      ),
    ),
    "UTC",
    instants("2027-01-08T14:00Z 2027-01-09T14:00Z 2027-01-10T14:00Z"),
  ],
  [
    "an all-day series over a skipped midnight",
    calendar(series("DTSTART;VALUE=DATE:20260904", "FREQ=DAILY;COUNT=4")),
    "America/Santiago",
    instants(
      "2026-09-04T04:00Z 2026-09-05T04:00Z 2026-09-06T04:00Z 2026-09-07T03:00Z",
    ),
  ],
  [
    "a timed override of an all-day series",
    calendar(
      series("DTSTART;VALUE=DATE:20270101", "FREQ=DAILY;COUNT=3"),
      event(
        "UID:series",
        "RECURRENCE-ID;VALUE=DATE:20270102",
        "DTSTART:20270102T140000Z",
      ),
    ),
    "UTC",
    instants("2027-01-01T00:00Z 2027-01-02T14:00Z 2027-01-03T00:00Z"),
  ],
] as const)
  test(`recurrence positions survive ${name}`, () => {
    assert.deepEqual(starts(feed, zone, "2026-09-01", "2027-02-01").sort(), [
      ...expected,
    ]);
  });

test("parameterized UIDs keep distinct events", () => {
  const { events } = scanCalendar(
    calendar(
      event("UID;X-SOURCE=example:one", "DTSTART:20270105T090000Z"),
      event("UID;X-SOURCE=example:two", "DTSTART:20270105T100000Z"),
    ),
    "UTC",
  );
  assert.equal(
    Object.values(events).filter((entry) => entry?.type === "VEVENT").length,
    2,
  );
});

test("quoted parameters cannot change recurrence value types", () => {
  const feed = calendar(
    series(
      'DTSTART;X-LABEL="a;VALUE=DATE;X=b":20270105T090000Z',
      "FREQ=DAILY;COUNT=2",
    ),
  );
  const actual = starts(feed, "UTC", "2027-01-05", "2027-01-07");
  assert.deepEqual(actual, instants("2027-01-05T09:00Z 2027-01-06T09:00Z"));
});

test("canonicalization is idempotent", (context) => {
  let canonical = "";
  const parse = ical.sync.parseICS;
  context.mock.method(ical.sync, "parseICS", (text: string) => {
    canonical = text;
    return parse(text);
  });
  scanCalendar(
    calendar(
      series(
        "DTSTART;TZID=Asia/Tokyo:20270101T090000",
        "FREQ=DAILY;UNTIL=20270103T000000Z",
        "EXDATE:20270102T000000Z",
      ),
    ),
    "Europe/Berlin",
  );
  const canonical1 = canonical;
  const first = scanCalendar(canonical1, "Europe/Berlin");
  const canonical2 = canonical;
  const second = scanCalendar(canonical2, "Europe/Berlin");
  assert.equal(canonical2, canonical1);
  assert.deepEqual(second.sources, first.sources);
});
