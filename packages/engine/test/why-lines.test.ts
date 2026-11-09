import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { shiftDay } from "../src/logging/day.ts";
import { insertActivity } from "../src/queries/insert-activity.ts";
import { upsertHabit } from "../src/queries/upsert-habit.ts";
import { upsertSignal } from "../src/queries/upsert-signal.ts";
import { upsertSleepPeriod } from "../src/queries/upsert-sleep-period.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const day = "2025-12-30";
const previous = "2025-12-29";
const late = "2025-12-29T19:15:00.000Z";
const updated_at = "2025-12-31T00:00:00.000Z";
const lateLine =
  "You trained within 4 hours of bed. Late hard workouts are linked to lower HRV.";

async function people(context: TestContext) {
  const { database, admin, member } = await twoUsers(context, "fallback");
  let record = 0;
  const nextId = () => {
    record += 1;
    return `${record}`;
  };
  const person = (who: typeof admin) => {
    const user_id = who.user.id;
    const seed = {
      signal(metric: string, value: number, onDay = day, source = "oura") {
        upsertSignal(database, {
          ...{ user_id, day: onDay, metric, value, source, updated_at },
        });
      },
      // Alternating values give a mean of the given level and a nonzero spread.
      baseline(metric: string, level: number, days = 14, source = "oura") {
        for (let offset = 1; offset <= days; offset += 1)
          seed.signal(
            metric,
            level + (offset % 2 ? 2 : -2) * (level / 50),
            shiftDay(day, -offset),
            source,
          );
      },
      sleep(onDay: string, started_at: string, minutes = 480) {
        const ended_at = new Date(Date.parse(started_at) + minutes * 6e4);
        upsertSleepPeriod(database, {
          ...{ user_id, source: "oura", source_record_id: nextId() },
          ...{ day: onDay, started_at, ended_at: ended_at.toISOString() },
          ...{ sleep_minutes: minutes, kind: "long_sleep", updated_at },
        });
      },
      nights() {
        seed.sleep(previous, "2025-12-28T22:00:00.000Z");
        seed.sleep(day, "2025-12-29T22:00:00.000Z");
      },
      session(kind: string, start: string | null, minutes = 45, on?: string) {
        insertActivity(database, {
          ...{ user_id, client_id: nextId(), kind, calories: null },
          ...{ notes: null, source: "manual", created_at: updated_at },
          ...{ timing: start ? "exact" : "date_only", started_at: start },
          ...{ day: on ?? start?.slice(0, 10) ?? day },
          duration_minutes: start ? minutes : null,
        });
      },
      habit(habit_key: string, onDay: string) {
        upsertHabit(database, {
          ...{ user_id, day: onDay, habit_key, amount: null, note: null },
          ...{ source: "manual", updated_at },
        });
      },
      async why(metric: string, source = "oura") {
        const response = await who.request(`/api/signals/${day}`);
        assert.equal(response.status, 200);
        const body = (await response.json()) as {
          signals: { metric: string; source: string; why: string[] }[];
        };
        const row = body.signals.find(
          (entry) => entry.metric === metric && entry.source === source,
        );
        assert.ok(row, `${metric} from ${source}`);
        return row.why;
      },
    };
    return seed;
  };
  return { personA: person(admin), personB: person(member) };
}

test("low HRV shows the late-workout and alcohol lines only for the person's own long, timed session and last evening's note", async (context) => {
  const { personA, personB } = await people(context);
  personA.baseline("hrv", 50);
  personA.signal("hrv", 42);
  personA.nights();
  personA.sleep(day, "2025-12-29T16:00:00.000Z", 40);
  personA.session("strength", late, 20);
  personA.session("strength", null, 0, previous);
  personA.habit("evening_alcohol", day);
  personB.nights();
  personB.session("strength", late);
  personB.habit("evening_alcohol", previous);
  assert.deepEqual(await personA.why("hrv"), []);
  personA.session("strength", late);
  const why = await personA.why("hrv");
  assert.deepEqual(why, [lateLine]);
  assert.doesNotMatch(why.join(" "), /because/i);
  personA.habit("evening_alcohol", previous);
  assert.deepEqual(await personA.why("hrv"), [
    lateLine,
    "You logged alcohol last evening. Alcohol is linked to lower HRV.",
  ]);
});

test("burn up gives the burn line on its own source's row, counting a date-only session", async (context) => {
  const { personA } = await people(context);
  personA.baseline("active_calories", 430, 14, "manual");
  personA.signal("active_calories", 640, day, "manual");
  personA.baseline("active_calories", 300);
  personA.signal("active_calories", 305);
  personA.session("running", null);
  const lead = "Burn 640 kcal, above your usual 430.";
  assert.deepEqual(await personA.why("active_calories", "manual"), [
    `${lead} You logged a workout.`,
  ]);
  personA.session("strength", `${day}T09:00:00.000Z`, 55);
  personA.session("cycling", `${day}T17:00:00.000Z`, 20);
  assert.deepEqual(await personA.why("active_calories", "manual"), [
    `${lead} You logged a 55-minute workout.`,
  ]);
  assert.deepEqual(await personA.why("active_calories", "oura"), []);
});

test("sauna the day before gives the not-settled line in either direction", async (context) => {
  const { personA } = await people(context);
  personA.baseline("hrv", 50);
  personA.signal("hrv", 60);
  personA.baseline("resting_heart_rate", 55);
  personA.signal("resting_heart_rate", 49);
  personA.nights();
  // A late day start hour stamps a morning sauna two calendar days back.
  personA.session("sauna", "2025-12-29T12:00:00.000Z", 20, "2025-12-28");
  assert.deepEqual(await personA.why("hrv"), [
    "You logged sauna yesterday. Its effect on HRV is not settled.",
  ]);
  assert.deepEqual(await personA.why("resting_heart_rate"), [
    "You logged sauna yesterday. Its effect on resting heart rate is not settled.",
  ]);
});

test("a short or flat baseline excluding the day, or HRV only 6 percent down, gives no line", async (context) => {
  const { personA } = await people(context);
  personA.nights();
  personA.session("strength", late);
  personA.baseline("hrv", 50, 13);
  personA.signal("hrv", 42);
  for (let offset = 1; offset <= 14; offset += 1)
    personA.signal("resting_heart_rate", 55, shiftDay(day, -offset));
  personA.signal("resting_heart_rate", 62);
  personA.baseline("hrv", 50, 14, "agent");
  personA.signal("hrv", 47, day, "agent");
  assert.deepEqual(await personA.why("hrv"), []);
  assert.deepEqual(await personA.why("resting_heart_rate"), []);
  assert.deepEqual(await personA.why("hrv", "agent"), []);
});

type Person = Awaited<ReturnType<typeof people>>["personA"];
const caveat =
  "Small sample; days you log may differ from days you don't in other ways.";
// Logs the item date-only on the first `logged` days back from yesterday; every night after gets HRV.
function history(
  seed: Person,
  kind: string,
  logged: number,
  total: number,
  level = 56,
) {
  for (let offset = 1; offset <= total; offset += 1) {
    const logDay = shiftDay(day, -offset);
    if (offset <= logged)
      kind === "evening_alcohol"
        ? seed.habit(kind, logDay)
        : seed.session(kind, null, 0, logDay);
    seed.signal("hrv", offset <= logged ? level : 50, shiftDay(logDay, 1));
  }
}

test("8 date-only logged days and 21 without give both counts; old days and missing nights count nowhere", async (context) => {
  const { personA } = await people(context);
  history(personA, "sauna", 8, 29);
  for (const offset of [40, 91])
    personA.session("sauna", null, 0, shiftDay(day, -offset));
  personA.signal("hrv", 56, shiftDay(day, -90));
  assert.deepEqual(await personA.why("hrv"), [
    `Nights after a logged sauna: HRV averaged 12% higher than nights without one logged (8 vs 21 nights). ${caveat}`,
  ]);
});

test("a 4 percent difference reads no clear difference yet", async (context) => {
  const { personA } = await people(context);
  history(personA, "evening_alcohol", 8, 29, 52);
  assert.deepEqual(await personA.why("hrv"), [
    `Nights after logged alcohol: no clear difference yet in HRV (8 vs 21 nights). ${caveat}`,
  ]);
});

test("4 logged days keep the tier-one line; a fifth replaces it", async (context) => {
  const { personA } = await people(context);
  personA.baseline("hrv", 50, 28);
  personA.signal("hrv", 60);
  personA.nights();
  for (const offset of [1, 3, 5, 7])
    personA.session("sauna", `${shiftDay(day, -offset)}T12:00:00.000Z`, 20);
  assert.deepEqual(await personA.why("hrv"), [
    "You logged sauna yesterday. Its effect on HRV is not settled.",
  ]);
  personA.session("sauna", `${shiftDay(day, -9)}T12:00:00.000Z`, 20);
  assert.match(
    (await personA.why("hrv")).join(),
    /^Nights after a logged sauna: .*\(5 vs 24 nights\)/,
  );
});

test("one person's pattern never counts another person's days", async (context) => {
  const { personA, personB } = await people(context);
  history(personB, "sauna", 8, 29);
  personA.signal("hrv", 56);
  personA.session("sauna", null, 0, previous);
  assert.deepEqual(await personA.why("hrv"), []);
});
