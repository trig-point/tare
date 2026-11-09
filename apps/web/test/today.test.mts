import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { twoUsers } from "../../../packages/engine/test/support/two-users.ts";
import { OutboxReplay } from "../src/outbox-replay.ts";
import { openOutboxStore } from "../src/outbox-store.ts";
import {
  changeIntake,
  changeWeight,
  enqueueWeight,
  intakeChanges,
  nutrients,
  readToday,
  settledSince,
  todayKey,
} from "../src/today-api.ts";
import "fake-indexeddb/auto";
import { test } from "./support.mts";
import "./tsx.mts";

const { Today } = await import("../src/today.tsx");
async function setup(context: Parameters<typeof twoUsers>[0]) {
  const { admin } = await twoUsers(context, "fallback");
  context.mock.method(globalThis, "fetch", (path: string, init: RequestInit) =>
    admin.request(path, init),
  );
  const response = await admin.request("/api/intake", {
    method: "POST",
    body: JSON.stringify({
      client_id: "example-food",
      name: "Example meal",
      kcal: 200,
      protein_g: 10,
      carbs_g: 20,
      fat_g: 5,
      fiber_g: 3,
    }),
  });
  assert.equal(response.status, 201);
  const { entry } = await response.json();
  return {
    person: admin.user,
    entry,
    read: () => readToday(new AbortController().signal),
  };
}
function render(
  person: { id: number; username: string },
  data: Awaited<ReturnType<typeof readToday>> | undefined,
  records: Parameters<typeof Today>[0]["records"] = [],
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  if (data) client.setQueryData(todayKey(person.id), data);
  else
    client
      .getQueryCache()
      .build(client, { queryKey: todayKey(person.id) })
      .setState({ status: "error", error: new Error("Unavailable") });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(Today, {
        person,
        records,
        online: false,
        replay: {} as OutboxReplay,
      }),
    ),
  );
}
test("today renders engine totals and provenance", async (context) => {
  const setupData = await setup(context);
  const html = render(setupData.person, await setupData.read());
  for (const pair of [
    /Calories<\/dt><dd>200</,
    /Protein \(g\)<\/dt><dd>10</,
    /Carbs \(g\)<\/dt><dd>20</,
    /Fat \(g\)<\/dt><dd>5</,
    /Fiber \(g\)<\/dt><dd>3</,
  ])
    assert.match(html, pair);
  assert.match(html, /Example meal.*estimated/s);
  const rounded = await setupData.read();
  rounded.totals.kcal.total = 220.00000000000003;
  const meal = rounded.entries[0];
  assert.ok(meal);
  meal.kcal = 220.00000000000003;
  meal.source = "off";
  const roundedHtml = render(setupData.person, rounded);
  assert.match(roundedHtml, /Calories<\/dt><dd>220</);
  assert.match(roundedHtml, /220 kcal/);
  assert.match(roundedHtml, /Open Food Facts/);
  assert.doesNotMatch(roundedHtml, /Target changed/);
  rounded.target_notice = {
    id: 1,
    old_kcal: 2100,
    old_protein_g: 112,
    new_kcal: 1820,
    new_protein_g: 140,
  };
  assert.match(
    render(setupData.person, rounded),
    /Target changed: 2,100 to 1,820 kcal, 112 to 140 g protein/,
  );
});
test("unknown totals are incomplete; missing and malformed responses fail", async (context) => {
  const setupData = await setup(context);
  await changeIntake(setupData.entry.id, { kcal: null });
  assert.match(
    render(setupData.person, await setupData.read()),
    /0 \+ Incomplete/,
  );
  const error = render(setupData.person, undefined);
  assert.match(error, /Couldn’t load today/);
  assert.doesNotMatch(error, /Loading\.\.\.|Today unavailable offline/);
  for (const body of [{}]) {
    context.mock.method(globalThis, "fetch", async () => Response.json(body));
    await assert.rejects(setupData.read());
  }
});
test("queued weights preserve measured time and refresh only after settlement", async (context) => {
  const store = await openOutboxStore({ name: `today-${crypto.randomUUID()}` });
  const replay = new OutboxReplay({
    store,
    online: () => false,
    channel: null,
    events: null,
  });
  context.after(async () => {
    await replay.close();
    store.close();
  });
  const person = { id: 1, username: "example-person" };
  await store.cacheSession(0, { user: person, mode: "fallback" });
  for (const value of ["", "0"])
    await assert.rejects(enqueueWeight(replay, person, value));
  await enqueueWeight(replay, person, "70");
  const [entry] = await store.entries(1);
  assert.ok(entry && typeof entry.body.measured_at === "string");
  assert.deepEqual(
    [entry.kind, entry.body.weight_kg, entry.state],
    ["weight", 70, "pending"],
  );
  const snapshot = await replay.snapshot();
  assert.equal(snapshot.type, "ready");
  if (snapshot.type !== "ready") throw new Error("Queue unavailable");
  const first = settledSince(new Set(), snapshot, person.id);
  assert.equal(first.settled, false);
  assert.equal(
    settledSince(
      first.pending,
      {
        ...snapshot,
        records: [],
        last_pass: { type: "retry", person_id: person.id, session_version: 1 },
      },
      person.id,
    ).settled,
    true,
  );
  assert.deepEqual(
    [...settledSince(new Set(), snapshot, person.id + 1).pending],
    [],
  );
});
test("pending markers are shown without duplicate synced entries", async (context) => {
  const setupData = await setup(context);
  const data = await setupData.read();
  const pending = {
    seq: 1,
    client_id: "pending-weight",
    kind: "weight" as const,
    person_id: setupData.person.id,
    body: { weight_kg: 70 },
    state: "pending" as const,
    revision: 0,
  };
  assert.match(render(setupData.person, data, [pending]), /70 kg.*Pending/s);
  data.weights.push({
    id: 1,
    client_id: pending.client_id,
    weight_kg: 70.04,
    body_fat_pct: null,
    measured_at: "2026-01-02T12:00:00.000Z",
    source: null,
  });
  const synced = render(setupData.person, data, [pending]);
  assert.doesNotMatch(synced, /Manual/);
  assert.match(synced, /<strong>70 kg<\/strong>/);
  assert.ok(
    synced.includes(
      new Date(data.weights[0]?.measured_at ?? "").toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        timeZone: data.timezone,
        timeZoneName: "short",
      }),
    ),
  );
  assert.doesNotMatch(synced, /<span>Pending<\/span>/);
});
test("edit updates totals and weight values", async (context) => {
  const setupData = await setup(context);
  await changeIntake(setupData.entry.id, { kcal: 250 });
  assert.equal((await setupData.read()).totals.kcal.total, 250);
  const response = await fetch("/api/weights", {
    method: "POST",
    body: JSON.stringify({ client_id: "example-weight", weight_kg: 70 }),
  });
  const { entry } = await response.json();
  await changeWeight(entry.id, { weight_kg: 71 });
  assert.equal((await setupData.read()).weights[0]?.weight_kg, 71);
});
test("delete updates totals and removes weights; empty days render", async (context) => {
  const setupData = await setup(context);
  await changeIntake(setupData.entry.id);
  const response = await fetch("/api/weights", {
    method: "POST",
    body: JSON.stringify({ client_id: "example-weight", weight_kg: 70 }),
  });
  const { entry } = await response.json();
  await changeWeight(entry.id);
  const data = await setupData.read();
  assert.equal(data.totals.kcal.total, 0);
  assert.deepEqual(data.weights, []);
  assert.match(render(setupData.person, data), /No food entries/);
});

test("intake changes preserve label claims and clear only exceeded calorie bounds", async (context) => {
  const { entry } = await setup(context);
  const original = {
    ...entry,
    provenance: "label" as const,
    source: "Example box",
    kcal_low: 180,
    kcal_high: 220,
  };
  const values = Object.fromEntries(
    nutrients.map((key) => [key, String(original[key])]),
  );
  const cases: [Record<string, string>, Record<string, unknown>][] = [
    [{}, {}],
    [
      { protein_g: "11" },
      { protein_g: 11, provenance: "label", source: "Example box" },
    ],
    [
      { kcal: "250" },
      {
        kcal: 250,
        kcal_low: null,
        kcal_high: null,
        provenance: "label",
        source: "Example box",
      },
    ],
    [
      { kcal: "210" },
      { kcal: 210, provenance: "label", source: "Example box" },
    ],
  ];
  for (const [patch, expected] of cases)
    assert.deepEqual(
      intakeChanges(original, { ...values, ...patch }),
      expected,
    );
});
