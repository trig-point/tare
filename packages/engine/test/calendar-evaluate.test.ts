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
  for (const title of ["(oFfIcE)", "officer"])
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
  assert(validCalendarKeyword("Équipe_2"));
  assert(!validCalendarKeyword("office day"));
});

test("empty, missing and malformed input never produces a false match", () => {
  assert.deepEqual(evaluateCalendar(input(calendar())), { status: "no_match" });
  assert.equal(
    status("UID:empty\nDTSTART:20270105T090000Z\nDURATION:PT1H"),
    "no_match",
  );
  assert.deepEqual(
    evaluateCalendar(input(calendar(event("DTSTART:not-a-date")))),
    { status: "unavailable" },
  );
});

test("half-open overlap includes ongoing events and excludes both touching bounds", () => {
  for (const [start, ending, expected] of [
    ["20270105T030000Z", "DTEND:20270105T040000Z", "no_match"],
    ["20270106T040000Z", "DURATION:PT1H", "no_match"],
    ["20270104T230000Z", "DTEND:20270105T050000Z", "match"],
  ])
    assert.equal(status(event(`DTSTART:${start}`, ending)), expected);
  assert.equal(
    status(
      "UID:week\nDTSTART;VALUE=DATE:20270101\nDTEND;VALUE=DATE:20270108\nRRULE:FREQ=WEEKLY;COUNT=3\nSUMMARY:Office",
      "2027-01-06",
      "Europe/Berlin",
    ),
    "match",
  );
  assert.equal(
    status(event("DTSTART:20270105T020000"), "2027-01-04", "Asia/Tokyo"),
    "match",
  );
});

test("F1 durations preserve elapsed hours, calendar days and series duration", () => {
  for (const [start, ending, rule, expected] of [
    ["20270328T013000", "DURATION:PT2H", "", "match"],
    ["20270328T010000", "DTEND:20270328T040000", "", "no_match"],
    [
      "20270321T013000",
      "DTEND:20270321T033000",
      "RRULE:FREQ=WEEKLY;COUNT=2",
      "match",
    ],
  ])
    assert.equal(
      status(
        `${event(`DTSTART:${start}`, ending)}\n${rule}`,
        "2027-03-28",
        "Europe/Berlin",
      ),
      expected,
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

test("moved, cancelled and orphan overrides select their own titles", () => {
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

test("per-event and total instance caps bound in-window work and old history evaluates", () => {
  const dense =
    "UID:dense\nDTSTART:20270104T040000Z\nDURATION:PT1M\nRRULE:FREQ=MINUTELY;COUNT=5000\nSUMMARY:Office";
  assert.equal(status(dense), "unavailable");
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
});
