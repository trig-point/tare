import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { twoUsers } from "../../../packages/engine/test/support/two-users.ts";
import {
  answerDose,
  type DueDose,
  dueDosesKey,
  readDueDoses,
} from "../src/doses-api.ts";
import { test } from "./support.mts";
import "./tsx.mts";

const { DueDoses, doseTapDelay } = await import("../src/due-doses.tsx");
const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
  await import("@tanstack/react-router");

async function render(
  doses: DueDose[] | Error,
  client = new QueryClient(),
  online = false,
) {
  if (doses instanceof Error) {
    await assert.rejects(
      client.fetchQuery({
        queryKey: dueDosesKey(1),
        queryFn: () => Promise.reject(doses),
      }),
    );
  } else {
    client.setQueryData(dueDosesKey(1), doses);
  }
  const router = createRouter({
    routeTree: createRootRoute({
      component: () =>
        createElement(DueDoses, { person: 1, online, timezone: "UTC" }),
    }),
    history: createMemoryHistory({ initialEntries: ["/#doses"] }),
  });
  await router.load();
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(RouterProvider, { router }),
    ),
  );
}

test("due and late doses list with Taken and Skip, which answer them", async (context) => {
  let now = new Date("2026-01-01T05:00:00Z");
  const { admin, database } = await twoUsers(context, "fallback", {
    clock: { now: () => now },
  });
  context.mock.method(globalThis, "fetch", (path: string, init: RequestInit) =>
    admin.request(path, init),
  );
  const send = async (path: string, body: object, method = "POST") =>
    assert.equal(
      (await admin.request(path, { method, body: JSON.stringify(body) }))
        .status,
      200,
    );
  await send("/api/me", { timezone: "UTC", day_start_hour: 4 }, "PATCH");
  const signal = new AbortController().signal;
  assert.deepEqual(await readDueDoses(signal), []);
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  for (const [name, time] of [
    ["Example Tablet", "08:00"],
    ["Example Drops", "06:00"],
    ["Example Later", "20:00"],
  ])
    await send("/api/medications/save", { name, days, times: [time] });
  now = new Date("2026-01-01T08:30:00Z");
  const due = await readDueDoses(signal);
  assert.deepEqual(due.map(({ name, status }) => [name, status]).sort(), [
    ["Example Drops", "late"],
    ["Example Tablet", "due"],
  ]);
  const html = await render(due);
  assert.match(html, /id="doses"/);
  assert.match(html, /Example Drops.*6:00.*Late.*Taken.*Skip/s);
  assert.match(html, /Example Tablet.*8:00(?:(?!Late).)*Taken.*Skip/s);
  const [tablet, drops] = ["Example Tablet", "Example Drops"].map(
    (name) => due.find((dose) => dose.name === name)?.key ?? "",
  ) as [string, string];
  await answerDose("log", tablet);
  await answerDose("skip", drops);
  const status = database.prepare(
    "SELECT status FROM medication_doses WHERE public_key = ?",
  );
  assert.deepEqual(
    [status.get(tablet), status.get(drops)],
    [{ status: "taken" }, { status: "skipped" }],
  );
  assert.deepEqual(await readDueDoses(signal), []);
  await assert.rejects(answerDose("skip", drops));
});

test("no due dose renders nothing; a malformed response fails", async (context) => {
  assert.equal(await render([]), "");
  context.mock.method(globalThis, "fetch", async () =>
    Response.json({
      medications: [
        {
          id: 1,
          name: "Example Tablet",
          status: {
            next_dose: {
              public_key: null,
              scheduled_at: "2026-01-01T08:00:00Z",
              status: "due",
            },
          },
        },
      ],
    }),
  );
  await assert.rejects(readDueDoses(new AbortController().signal));
});

test("a failed load shows an alert inside the doses section", async () => {
  const html = await render(new Error("Load failed"));
  assert.match(
    html,
    /<section id="doses"[^>]*>.*<p [^>]*role="alert"[^>]*>Couldn&#x27;t load doses<\/p>.*<\/section>/s,
  );
});

test("changed dose rows block taps for 700 ms", async (context) => {
  const client = new QueryClient();
  const dose: DueDose = {
    key: "tablet",
    name: "Example Tablet",
    scheduled_at: "2026-01-01T08:00:00Z",
    status: "due",
  };
  const next = { ...dose, key: "drops", name: "Example Drops" };
  await render([dose, next], client, true);
  const changed = await render([next], client, true);
  assert.equal((changed.match(/<button[^>]* disabled=""/g) ?? []).length, 2);

  context.mock.timers.enable({ apis: ["setTimeout"] });
  const delay = doseTapDelay(next.key);
  const notify = context.mock.fn();
  const unsubscribe = delay.subscribe(notify);
  assert.notEqual(delay.getSnapshot(), next.key);
  context.mock.timers.tick(699);
  assert.notEqual(delay.getSnapshot(), next.key);
  context.mock.timers.tick(1);
  assert.equal(delay.getSnapshot(), next.key);
  assert.equal(notify.mock.callCount(), 1);
  unsubscribe();
});
