import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { twoUsers } from "../../../packages/engine/test/support/two-users.ts";
import { OutboxReplay } from "../src/outbox-replay.ts";
import { openOutboxStore } from "../src/outbox-store.ts";
import {
  changeIntake,
  changeWeight,
  enqueueWeight,
  readToday,
  todayKey,
} from "../src/today-api.ts";
import "fake-indexeddb/auto";
import { test } from "./support.mts";

registerHooks({
  load(url, context, next) {
    if (!url.endsWith(".tsx")) return next(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText,
    };
  },
});
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
  data: Awaited<ReturnType<typeof readToday>>,
  records: Parameters<typeof Today>[0]["records"] = [],
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  client.setQueryData(todayKey(person.id), data);
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
  for (const expected of [
    "200",
    "10",
    "20",
    "5",
    "3",
    "Example meal",
    "estimated",
  ])
    assert.ok(html.includes(expected), expected);
});
test("unknown totals are incomplete; missing and malformed responses fail", async (context) => {
  const setupData = await setup(context);
  await changeIntake(setupData.entry.id, { kcal: null });
  assert.match(
    render(setupData.person, await setupData.read()),
    /0 \+ Incomplete/,
  );
  for (const body of [{}, { day: 42 }]) {
    context.mock.method(globalThis, "fetch", async () => Response.json(body));
    await assert.rejects(setupData.read());
  }
});
test("weight writes use the durable queue and preserve measured time", async (context) => {
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
  for (const value of ["", "no", "0"])
    await assert.rejects(enqueueWeight(replay, person, value));
  await enqueueWeight(replay, person, "70");
  const [entry] = await store.entries(1);
  assert.ok(entry && typeof entry.body.measured_at === "string");
  assert.deepEqual(
    [entry.kind, entry.body.weight_kg, entry.state],
    ["weight", 70, "pending"],
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
    weight_kg: 70,
    measured_at: "2026-01-02T12:00:00.000Z",
    source: null,
  });
  assert.doesNotMatch(
    render(setupData.person, data, [pending]),
    /<span>Pending<\/span>/,
  );
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
