import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { generateAll } from "../src/medications/store.ts";
import { listDoses } from "../src/queries/medications/list-doses.ts";
import { mcpSession } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

async function setup(
  context: TestContext,
  start = "2026-01-01T08:00:00Z",
  zone = "UTC",
) {
  let now = new Date(start);
  const { admin, database } = await twoUsers(context, "fallback", {
    clock: { now: () => now },
  });
  async function call(
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) {
    const response = await admin.request(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, ...(await response.json()) };
  }
  assert.equal(
    (await call("/api/me", { timezone: zone, day_start_hour: 4 }, "PATCH"))
      .status,
    200,
  );
  return {
    database,
    call,
    doses: (medication_id: number) => listDoses(database, { medication_id }),
    action: (action: string, dose: number | string, fields = {}) =>
      call(`/api/medications/doses/${action}`, { dose, ...fields }),
    zone: (timezone: string) =>
      call("/api/me", { timezone, day_start_hour: 4 }, "PATCH"),
    generate: () => generateAll(database, now),
    step: (instant: string) => {
      now = new Date(instant);
    },
    save: (body: unknown) => call("/api/medications/save", body),
  };
}

test("generation fills its horizon, backfills after downtime, and is idempotent", async (context) => {
  const { database, save, step, call, generate } = await setup(context);
  const created = await save({
    name: "Example Supplement",
    days: weekdays,
    times: ["09:00"],
  });
  assert.equal(created.status, 200);
  const doses = () =>
    database
      .prepare(
        "SELECT slot_date, status FROM medication_doses ORDER BY slot_date",
      )
      .all();
  const first = doses();
  assert.equal(first.length, 14);
  assert.deepEqual(first.at(-1), {
    slot_date: "2026-01-14",
    status: "scheduled",
  });
  step("2026-01-18T12:00:00Z");
  assert.equal(generate(), 18);
  assert.equal(doses().length, 32);
  const listed = await call("/api/medications");
  assert.equal(listed.medications[0].status.late_count, 18);
  const backfilled = doses();
  assert.equal(generate(), 0);
  assert.deepEqual(doses(), backfilled);
});

test("DST gap preserves two keys at the same instant", async (context) => {
  const lane = await setup(context, "2026-03-07T18:00:00Z", "America/New_York");
  const { medication } = await lane.save({
    name: "Example Drops",
    days: ["sun"],
    times: ["02:30", "03:30"],
  });
  const gap = lane
    .doses(medication.id)
    .filter((dose) => dose.slot_date === "2026-03-08");
  assert.deepEqual(
    gap.map((dose) => [dose.slot_time, dose.slot_at]),
    [
      ["02:30", "2026-03-08T07:30:00.000Z"],
      ["03:30", "2026-03-08T07:30:00.000Z"],
    ],
  );
  assert.equal(new Set(gap.map((dose) => dose.public_key)).size, 2);
});

test("schedule revision preserves current-day and resolved future rows", async (context) => {
  const lane = await setup(context);
  const { medication } = await lane.save({
    name: "Example Tablets",
    days: weekdays,
    times: ["09:00", "12:00"],
  });
  const [snoozed, secondToday, taken, skipped] = lane.doses(medication.id);
  assert.ok(snoozed && secondToday && taken && skipped);
  assert.equal(
    (await lane.action("snooze", snoozed.id, { minutes: 10 })).status,
    200,
  );
  assert.equal((await lane.action("log", taken.id)).status, 200);
  assert.equal((await lane.action("skip", skipped.id)).status, 200);
  const before = lane.doses(medication.id);
  const kept = new Set([snoozed.id, secondToday.id, taken.id, skipped.id]);
  assert.equal(
    (await lane.save({ id: medication.id, times: ["10:00"] })).status,
    200,
  );
  assert.equal(
    (await lane.save({ id: medication.id, times: ["11:00"] })).status,
    200,
  );
  const after = lane.doses(medication.id);
  assert.deepEqual(
    after.filter((dose) => kept.has(dose.id)),
    before.filter((dose) => kept.has(dose.id)),
  );
  assert.deepEqual(
    [
      ...new Set(
        after
          .filter((dose) => !kept.has(dose.id))
          .map((dose) => dose.slot_time),
      ),
    ],
    ["11:00"],
  );
  const row = after.find((dose) => !kept.has(dose.id));
  assert.equal(
    (await lane.save({ id: medication.id, times: ["11:00", "13:00"] })).status,
    200,
  );
  assert.equal(
    lane.doses(medication.id).find((dose) => dose.id === row?.id)?.public_key,
    row?.public_key,
  );
});

test("timezone save moves future doses in place and retains a slot that moves to the past", async (context) => {
  const lane = await setup(context);
  const { medication } = await lane.save({
    name: "Example Chews",
    days: weekdays,
    times: ["09:00", "16:00"],
  });
  const [crosses, future] = lane.doses(medication.id);
  assert.ok(crosses && future);
  assert.equal((await lane.zone("Europe/Paris")).status, 200);
  const after = lane.doses(medication.id);
  assert.deepEqual(
    after.find((dose) => dose.id === crosses.id),
    crosses,
  );
  assert.equal(
    after.find((dose) => dose.id === future.id)?.slot_at,
    "2026-01-01T15:00:00.000Z",
  );
});

test("deactivation stops past doses, drops future doses and reactivation starts a clean interval", async (context) => {
  const lane = await setup(context);
  const { medication } = await lane.save({
    name: "Example Powder",
    days: weekdays,
    times: ["09:00"],
  });
  const [past] = lane.doses(medication.id);
  assert.ok(past);
  lane.step("2026-01-01T10:00:00Z");
  const snoozed = await lane.action("snooze", past.id, { minutes: 30 });
  assert.equal(snoozed.status, 200);
  const off = await lane.save({
    id: medication.id,
    active: false,
    times: ["11:00"],
  });
  assert.equal(off.medication.status, null);
  assert.deepEqual(lane.doses(medication.id), [
    {
      ...past,
      scheduled_at: snoozed.dose.scheduled_at,
      status: "skipped",
      skip_reason: "stopped",
      resolved_at: "2026-01-01T10:00:00.000Z",
    },
  ]);
  assert.equal((await lane.action("log", past.id)).dose.status, "taken");
  lane.step("2026-01-03T10:00:00Z");
  assert.equal(
    (await lane.save({ id: medication.id, active: true })).status,
    200,
  );
  assert.equal(
    lane.doses(medication.id)[1]?.slot_at,
    "2026-01-03T11:00:00.000Z",
  );
});

test("hold deletion restores a future dose and a started hold can end yesterday", async (context) => {
  const lane = await setup(context);
  const { medication } = await lane.save({
    name: "Example Wafers",
    days: weekdays,
    times: ["09:00"],
  });
  const medication_id = medication.id;
  const saveHold = (body: object) =>
    lane.call("/api/medications/holds/save", { medication_id, ...body });
  const deleteHold = (id: number) =>
    lane.call("/api/medications/holds/delete", { medication_id, id });
  const list = async () =>
    (await lane.call("/api/medications")).medications[0].status;
  const future = await saveHold({
    from_date: "2026-01-02",
    to_date: "2026-01-05",
  });
  assert.equal((await deleteHold(future.hold.id)).status, 200);
  const started = await saveHold({
    from_date: "2026-01-01",
    to_date: "2026-01-01",
  });
  lane.step("2026-01-01T12:00:00Z");
  assert.equal((await list()).late_count, 0);
  assert.equal(
    (await list()).next_dose.scheduled_at,
    "2026-01-02T09:00:00.000Z",
  );
  assert.equal((await deleteHold(started.hold.id)).error.code, "hold_started");
  assert.equal(
    (await saveHold({ id: started.hold.id, to_date: "2025-12-30" })).status,
    400,
  );
  assert.equal(
    (await saveHold({ id: started.hold.id, to_date: "2025-12-31" })).status,
    200,
  );
  assert.equal((await list()).late_count, 1);
});

test("dose transitions, snooze bounds and next dose use the stepped clock", async (context) => {
  const lane = await setup(context);
  const { medication } = await lane.save({
    name: "Example Lozenges",
    days: weekdays,
    times: ["09:00", "12:00"],
  });
  const [first, second] = lane.doses(medication.id);
  assert.ok(first && second);
  lane.step("2026-01-01T10:00:00Z");
  for (const until of ["2026-01-01T09:30:00Z", "2026-01-01T12:00:00Z"])
    assert.equal(
      (await lane.action("snooze", first.id, { until })).error.code,
      "invalid_time",
    );
  assert.equal(
    (await lane.action("snooze", first.id, { minutes: 5 })).dose.scheduled_at,
    "2026-01-01T10:05:00.000Z",
  );
  assert.equal(
    (await lane.action("log", first.id, { taken_at: "2026-01-01T11:00:00Z" }))
      .status,
    400,
  );
  assert.equal(
    (
      await lane.action("log", first.id, {
        taken_at: "9999-12-31T23:59:00-01:00",
      })
    ).status,
    400,
  );
  assert.equal(
    (await lane.action("log", first.public_key)).dose.status,
    "taken",
  );
  assert.equal((await lane.action("log", first.id)).error.code, "dose_exists");
  assert.equal(
    (await lane.action("snooze", first.id, { minutes: 5 })).status,
    409,
  );
  assert.equal(
    (
      await lane.action("log", first.id, {
        replace: true,
        taken_at: "2026-01-01T09:59:00Z",
      })
    ).dose.taken_at,
    "2026-01-01T09:59:00.000Z",
  );
  const undone = await lane.action("undo", first.id);
  assert.equal(undone.dose.status, "late");
  assert.equal(undone.dose.scheduled_at, first.slot_at);
  assert.equal((await lane.action("skip", second.id)).dose.skip_reason, "user");
  assert.equal((await lane.action("undo", second.id)).dose.status, "scheduled");
  const next = async () =>
    (await lane.call("/api/medications")).medications[0].status.next_dose;
  lane.step("2026-01-01T12:10:00Z");
  assert.equal((await next()).id, second.id);
  const nextMorning = lane.doses(medication.id)[2];
  assert.ok(nextMorning);
  assert.equal((await lane.action("skip", nextMorning.id)).status, 200);
  lane.step("2026-01-02T12:01:00Z");
  assert.equal((await next()).scheduled_at, "2026-01-02T12:00:00.000Z");
  const nextNoon = lane.doses(medication.id)[3];
  assert.ok(nextNoon);
  assert.equal((await lane.action("skip", nextNoon.id)).status, 200);
  assert.equal((await next()).scheduled_at, "2026-01-03T09:00:00.000Z");
});

test("malformed medication commands return the same refusal over HTTP and MCP", async (context) => {
  const lane = await twoUsers(context, "access");
  const client = await mcpSession(context, lane, lane.admin.user.id);
  for (const [name, path, args] of [
    ["save_medication", "save", { name: " ", days: [], times: ["25:00"] }],
    ["log_dose", "doses/log", { dose: false }],
    ["snooze_dose", "doses/snooze", { dose: 1, minutes: -1 }],
    ["save_hold", "holds/save", { medication_id: 1, to_date: "2026-02-30" }],
  ] as const) {
    const response = await lane.admin.request(`/api/medications/${path}`, {
      method: "POST",
      body: JSON.stringify(args),
    });
    assert.equal(response.status, 400);
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true);
    const [content] = result.content as { text: string }[];
    assert.ok(content);
    assert.deepEqual(JSON.parse(content.text), await response.json());
  }
});

test("changing the day start rebases a pending edit and removes its obsolete doses", async (context) => {
  const lane = await setup(context);
  const { medication } = await lane.save({
    name: "Example Gems",
    days: weekdays,
    times: ["06:00"],
  });
  assert.equal(
    (await lane.save({ id: medication.id, times: ["07:00"] })).status,
    200,
  );
  assert.equal(
    (
      await lane.call(
        "/api/me",
        { timezone: "UTC", day_start_hour: 8 },
        "PATCH",
      )
    ).status,
    200,
  );
  const nextDay = lane
    .doses(medication.id)
    .filter((dose) => dose.slot_date === "2026-01-02");
  assert.deepEqual(
    nextDay.map((dose) => dose.slot_time),
    ["06:00"],
  );
});

test("a hold through the date limit keeps medication reads available", async (context) => {
  const lane = await setup(context);
  const { medication } = await lane.save({
    name: "Example Pellets",
    days: weekdays,
    times: ["09:00"],
  });
  assert.equal(
    (
      await lane.call("/api/medications/holds/save", {
        medication_id: medication.id,
        from_date: "2026-01-01",
        to_date: "9999-12-31",
      })
    ).status,
    200,
  );
  const listed = await lane.call("/api/medications");
  assert.equal(listed.status, 200);
  assert.equal(listed.medications[0].status.next_dose, null);
});

test("undo restores a recent resolution and refuses expired or inactive corrections", async (context) => {
  for (const scenario of [
    { name: "Example Recent", action: "log", expected: null },
    { name: "Example Expired", action: "skip", expected: "undo_expired" },
    {
      name: "Example Inactive",
      action: "skip",
      expected: "medication_inactive",
    },
  ]) {
    const lane = await setup(context);
    const { medication } = await lane.save({
      name: scenario.name,
      days: weekdays,
      times: ["09:00"],
    });
    const [dose] = lane.doses(medication.id);
    assert.ok(dose);
    assert.equal(
      (await lane.action("snooze", dose.id, { minutes: 10 })).status,
      200,
    );
    const fields =
      scenario.action === "log" ? { taken_at: "2025-12-30T08:00:00Z" } : {};
    assert.equal(
      (await lane.action(scenario.action, dose.id, fields)).status,
      200,
    );
    if (scenario.expected === "undo_expired") lane.step("2026-01-02T08:00:01Z");
    if (scenario.expected === "medication_inactive")
      assert.equal(
        (await lane.save({ id: medication.id, active: false })).status,
        200,
      );
    if (!scenario.expected) {
      lane.step("2026-01-01T08:05:00Z");
      assert.equal((await lane.zone("America/New_York")).status, 200);
    }
    const result = await lane.action("undo", dose.id);
    if (scenario.expected) {
      assert.equal(result.status, 409);
      assert.equal(result.error.code, scenario.expected);
    } else {
      assert.equal(result.status, 200);
      assert.deepEqual(lane.doses(medication.id)[0], dose);
    }
  }
});

test("today and read_day place each dose on its Tare day", async (context) => {
  const { action, call, doses, save, step } = await setup(context);
  const { medication } = await save({
    name: "Example Tonic",
    days: weekdays,
    times: ["01:00", "02:00", "09:00"],
  });
  const scheduled = doses(medication.id).find(
    (dose) => dose.slot_time === "09:00",
  );
  const [skipped, taken] = doses(medication.id).filter(
    (dose) => dose.slot_date === "2026-01-02",
  );
  assert.ok(scheduled && skipped && taken);
  step("2026-01-02T04:15:00Z");
  assert.equal((await action("skip", skipped.id)).status, 200);
  assert.equal((await action("log", taken.id)).status, 200);
  const relevant = new Set([scheduled.id, skipped.id, taken.id]);
  const read = async (path: string) =>
    (await call(path)).doses
      .filter((dose: { id: number }) => relevant.has(dose.id))
      .map((dose: { id: number; status: string }) => [dose.id, dose.status]);
  assert.deepEqual(await read("/api/days/2026-01-01"), [
    [scheduled.id, "late"],
    [skipped.id, "skipped"],
  ]);
  for (const path of ["/api/days/2026-01-02", "/api/today"])
    assert.deepEqual(await read(path), [[taken.id, "taken"]]);
});
