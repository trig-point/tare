import assert from "node:assert/strict";
import ical from "node-ical";
import { evaluateCalendar } from "../src/calendar/evaluate.ts";
import { validCalendarKeyword } from "../src/calendar/index.ts";
import { test } from "./support/hang-ceiling.ts";

process.env.TZ = "UTC";
const calendar = (...bodies: string[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...bodies.map((body) => `BEGIN:VEVENT\n${body}\nEND:VEVENT`),
    "END:VCALENDAR",
  ].join("\n");
const input = (
  feed_text: string,
  day = "2027-01-05",
  timezone = "UTC",
  day_start_hour = 4,
  keywords = ["office"],
) => ({ feed_text, day, timezone, day_start_hour, keywords });
const event = (start: string, ending = "DURATION:PT1H", summary = "Office") =>
  `UID:event\n${start}\n${ending}\nSUMMARY:${summary}`;
const status = (body: string, day?: string, zone?: string, hour?: number) =>
  evaluateCalendar(input(calendar(body), day, zone, hour)).status;

test("literal Unicode keywords use whole words and first-rule order", () => {
  for (const title of ["Office day", "(oFfIcE)", "Office, day", "officer"])
    assert.equal(
      status(event("DTSTART:20270105T090000Z", "DURATION:PT1H", title)),
      title === "officer" ? "no_match" : "match",
    );
  const feed = calendar(
    event("DTSTART:20270105T090000Z", "DURATION:PT1H", "Lower"),
    "UID:priority\nDTSTART:20270105T100000Z\nDURATION:PT1H\nSUMMARY;LANGUAGE=en:Équipe_2",
  );
  assert.deepEqual(
    evaluateCalendar(
      input(feed, undefined, undefined, undefined, ["éQUIPE_2", "lower"]),
    ),
    { status: "match", rule_index: 0 },
  );
  for (const [title, keyword, expected] of [
    ["İstanbul trip", "İstanbul", "match"],
    ["İstanbul trip", "i", "no_match"],
    ["Cafe\u0301 visit", "Café", "match"],
    ["Office\u0301", "office", "no_match"],
    ["ΟΔΟΣ", "οδοσ", "match"],
  ] as const)
    assert.equal(
      evaluateCalendar(
        input(
          calendar(event("DTSTART:20270105T090000Z", "DURATION:PT1H", title)),
          undefined,
          undefined,
          undefined,
          [keyword],
        ),
      ).status,
      expected,
      `${title} with ${keyword}`,
    );
  for (const keyword of ["office", "Équipe_2", "123"])
    assert(validCalendarKeyword(keyword));
  for (const keyword of ["", "office day", "office.*", "a".repeat(41)])
    assert(!validCalendarKeyword(keyword));
});

test("empty, missing and malformed input never produces a false match", () => {
  assert.deepEqual(evaluateCalendar(input(calendar())), { status: "no_match" });
  assert.equal(
    status("UID:empty\nDTSTART:20270105T090000Z\nDURATION:PT1H"),
    "no_match",
  );
  for (const value of [
    undefined,
    {},
    input("invalid"),
    input(calendar(event("DTSTART:not-a-date"))),
    input(calendar(), undefined, undefined, undefined, ["bad word"]),
  ])
    assert.deepEqual(evaluateCalendar(value), { status: "unavailable" });
  assert.equal(
    evaluateCalendar(
      input(
        calendar(event("DTSTART:20270105T090000Z")),
        undefined,
        undefined,
        undefined,
        [],
      ),
    ).status,
    "no_match",
  );
});

test("half-open overlap includes ongoing events and excludes both touching bounds", () => {
  for (const [start, ending, expected] of [
    ["20270105T030000Z", "DTEND:20270105T040000Z", "no_match"],
    ["20270106T040000Z", "DURATION:PT1H", "no_match"],
    ["20270104T230000Z", "DTEND:20270105T050000Z", "match"],
  ])
    assert.equal(status(event(`DTSTART:${start}`, ending)), expected);
  for (const suffix of ["", "\nRRULE:FREQ=WEEKLY;COUNT=2"])
    assert.equal(
      status(
        `UID:span\nDTSTART;VALUE=DATE:20270101\nDTEND;VALUE=DATE:20270104\nSUMMARY:Office${suffix}`,
        "2027-01-03",
        "Asia/Tokyo",
      ),
      "match",
    );
  assert.equal(
    status(
      "UID:week\nDTSTART;VALUE=DATE:20270101\nDTEND;VALUE=DATE:20270108\nRRULE:FREQ=WEEKLY;COUNT=3\nSUMMARY:Office",
      "2027-01-06",
      "Europe/Berlin",
    ),
    "match",
  );
  for (const zone of ["Asia/Tokyo", "America/Los_Angeles"]) {
    assert.equal(
      status(event("DTSTART:20270105T020000"), "2027-01-04", zone),
      "match",
    );
    assert.equal(
      status(event("DTSTART:20270105T020000"), "2027-01-05", zone),
      "no_match",
    );
  }
});

test("F1 durations preserve elapsed hours, calendar days and series duration", () => {
  for (const [start, ending, rule, day, expected] of [
    ["20270328T013000", "DURATION:PT2H", "", "2027-03-28", "match"],
    ["20270328T010000", "DURATION:PT3H", "", "2027-03-28", "match"],
    ["20270328T010000", "DURATION:P1D", "", "2027-03-28", "match"],
    ["20270328T010000", "DTEND:20270328T040000", "", "2027-03-28", "no_match"],
    [
      "20270321T013000",
      "DURATION:PT2H",
      "RRULE:FREQ=WEEKLY;COUNT=2",
      "2027-03-28",
      "match",
    ],
    [
      "20270321T013000",
      "DTEND:20270321T033000",
      "RRULE:FREQ=WEEKLY;COUNT=2",
      "2027-03-28",
      "match",
    ],
    ["20270328T013000", "DURATION:P1D", "", "2027-03-29", "no_match"],
  ])
    for (const parameters of ["", ";TZID=Europe/Berlin"])
      assert.equal(
        status(
          `${event(`DTSTART${parameters}:${start}`, ending)}\n${rule}`,
          day,
          "Europe/Berlin",
        ),
        expected,
      );
  assert.equal(
    status(
      event("DTSTART:20270328T013000", "DURATION:PT2H"),
      "2027-03-28",
      "Europe/Berlin",
      5,
    ),
    "no_match",
  );
  assert.equal(
    status(
      event("DTSTART:20270328T010000", "DTEND:20270328T020000"),
      "2027-03-28",
      "Europe/Berlin",
      2,
    ),
    "no_match",
  );
  assert.equal(
    status(
      event("DTSTART:20271031T023000", "DURATION:PT30M"),
      "2027-10-30",
      "Europe/Berlin",
      3,
    ),
    "match",
  );
  const override = calendar(
    "UID:own-end\nDTSTART:20270321T013000\nDURATION:PT1H\nRRULE:FREQ=WEEKLY;COUNT=2\nSUMMARY:Lower",
    "UID:own-end\nRECURRENCE-ID:20270328T013000\nDTSTART:20270328T013000\nDURATION:PT2H\nSUMMARY:Office",
  );
  assert.equal(
    evaluateCalendar(input(override, "2027-03-28", "Europe/Berlin")).status,
    "match",
  );
  assert.equal(
    status(
      event("DTSTART:20270328T013000", "DURATION:P1D"),
      "2027-03-29",
      "Europe/Berlin",
      2,
    ),
    "no_match",
  );
});

test("moved, cancelled, orphan and mixed-form overrides select their own titles", () => {
  for (const cancelled of [
    "STATUS:CANCELLED",
    "STATUS:Cancelled",
    "STATUS;X-SOURCE=sample:CANCELLED",
  ])
    assert.equal(
      status(`${event("DTSTART:20270105T090000Z")}\n${cancelled}`),
      "no_match",
      cancelled,
    );
  const master =
    "UID:series\nDTSTART:20270101T090000\nDURATION:PT1H\nRRULE:FREQ=DAILY;COUNT=10\nSUMMARY:Lower";
  const moved =
    "UID:series\nRECURRENCE-ID:20270102T090000\nDTSTART:20270106T120000\nDURATION:PT1H\nSUMMARY:Office";
  assert.equal(
    evaluateCalendar(input(calendar(master, moved), "2027-01-02")).status,
    "no_match",
  );
  assert.equal(
    evaluateCalendar(input(calendar(master, moved), "2027-01-06")).status,
    "match",
  );
  assert.equal(
    evaluateCalendar(
      input(calendar(master, `${moved}\nSTATUS:CANCELLED`), "2027-01-06"),
    ).status,
    "no_match",
  );
  assert.equal(status(moved, "2027-01-06"), "match");
  const utcMaster = master.replace("090000", "090000Z");
  const floatingMove = moved.replace(
    "RECURRENCE-ID:20270102T090000",
    "RECURRENCE-ID:20270102T090000Z",
  );
  assert.equal(
    evaluateCalendar(
      input(calendar(utcMaster, floatingMove), "2027-01-06", "Asia/Tokyo"),
    ).status,
    "match",
  );
});

test("F3 SEQUENCE retains the kept override's source form", (context) => {
  context.mock.method(console, "warn", () => {});
  const master =
    "UID:sequence\nDTSTART:20270101T090000Z\nDURATION:PT1H\nRRULE:FREQ=DAILY;COUNT=3\nSUMMARY:Lower";
  const newer =
    "UID:sequence\nRECURRENCE-ID:20270102T090000Z\nSEQUENCE:2\nDTSTART:20270102T010000Z\nDURATION:PT1H\nSUMMARY:Office";
  const older = newer
    .replace("SEQUENCE:2", "SEQUENCE:1")
    .replace("DTSTART:20270102T010000Z", "DTSTART:20270102T010000");
  assert.equal(
    evaluateCalendar(
      input(calendar(master, newer, older), "2027-01-02", "Asia/Tokyo"),
    ).status,
    "match",
  );
});

test("F4 unsupported zones and an injected source-join failure are unavailable", (context) => {
  const lower = event("DTSTART:20270105T090000Z", "DURATION:PT1H", "Lower");
  assert.deepEqual(
    evaluateCalendar(
      input(
        calendar(
          lower,
          "UID:unknown\nDTSTART;TZID=Unlisted/Office:20270105T030000\nSUMMARY:Office",
        ),
        undefined,
        undefined,
        undefined,
        ["office", "lower"],
      ),
    ),
    { status: "unavailable" },
  );
  const expand = ical.expandRecurringEvent;
  context.mock.method(
    ical,
    "expandRecurringEvent",
    (...args: Parameters<typeof expand>) =>
      expand(...args).map((instance) => ({
        ...instance,
        event: { ...instance.event, uid: "missing" },
      })),
  );
  assert.equal(status(lower), "unavailable");
});

test("instance caps bound in-window work, old history evaluates and RDATE is unavailable", () => {
  const dense =
    "UID:dense\nDTSTART:20270104T040000Z\nDURATION:PT1M\nRRULE:FREQ=MINUTELY;COUNT=5000\nSUMMARY:Office";
  assert.equal(status(dense), "unavailable");
  const ended = dense
    .replace("UID:dense", "UID:ended")
    .replace("COUNT=5000", "UNTIL=20270104T040100Z")
    .replace("SUMMARY:Office", "SUMMARY:Lower");
  assert.equal(
    evaluateCalendar(input(calendar(ended, event("DTSTART:20270105T090000Z"))))
      .status,
    "match",
  );
  const many = Array.from({ length: 12 }, (_, index) =>
    dense
      .replace("UID:dense", `UID:dense-${index}`)
      .replace(
        "FREQ=MINUTELY;COUNT=5000",
        "FREQ=MINUTELY;INTERVAL=5;COUNT=1000",
      ),
  );
  assert.equal(
    evaluateCalendar(input(calendar(...many))).status,
    "unavailable",
  );
  const history = Array.from(
    { length: 2001 },
    (_, index) => `UID:old-${index}\nDTSTART:20200101T090000Z\nDURATION:PT1H`,
  );
  assert.equal(
    evaluateCalendar(
      input(calendar(...history, event("DTSTART:20270105T090000Z"))),
    ).status,
    "match",
  );
  const rdate = `${event("DTSTART:20270101T090000Z")}\nRDATE:20270110T090000Z`;
  assert.equal(status(rdate, "2027-01-01"), "unavailable");
  assert.equal(status(rdate, "2027-01-10"), "unavailable");
});
