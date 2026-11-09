import assert from "node:assert/strict";
import {
  environmentManager,
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { twoUsers } from "../../../packages/engine/test/support/two-users.ts";
import { signalsQuery } from "../src/health-api.ts";
import { type Bonus, type TodayData, todayQuery } from "../src/today-api.ts";
import { test } from "./support.mts";
import "./tsx.mts";

const { TargetCard } = await import("../src/profile.tsx");
const { BodyCard } = await import("../src/health.tsx");
const day = "2026-01-01";
const text = (node: ReactElement, client = new QueryClient()) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client }, node))
    .replaceAll("&#x27;", "'")
    .replaceAll(" ", " ");

const synced = `${day}T14:30:00.000Z`;

async function setup(context: Parameters<typeof twoUsers>[0]) {
  const { admin, database, setNow } = await twoUsers(context, "fallback");
  setNow(`${day}T15:00:00.000Z`);
  context.mock.method(globalThis, "fetch", (path: string, init: RequestInit) =>
    admin.request(path, init),
  );
  const profile = `{"height_cm":180,"birth_date":"1986-01-01","sex":"male","activity_level":"moderate","goal_rate_kg_week":-0.5}`;
  for (const [path, body] of [
    ["/api/profile", profile],
    ["/api/weights", `{"client_id":"weight","weight_kg":80}`],
  ] as const)
    assert.ok((await fetch(path, { method: "POST", body })).ok);
  database
    .prepare(
      "INSERT INTO oura_connections (user_id, version, ciphertext, iv, tag, access_expires_at, scopes, scope_source, status, generation, last_synced_at, created_at, updated_at) VALUES (?, 1, 'x', 'x', 'x', ?, 'daily', 'requested', 'connected', 1, ?, ?, ?)",
    )
    .run(admin.user.id, ...Array(4).fill(synced));
  const burn = database.prepare(
    "INSERT OR REPLACE INTO daily_signals VALUES (?, date(?, ?), 'active_calories', ?, 'oura', ?)",
  );
  for (let offset = 1; offset <= 28; offset++)
    burn.run(admin.user.id, day, `-${offset} days`, 430, synced);
  const setToday = (value: number) =>
    burn.run(admin.user.id, day, "+0 days", value, synced);
  return { person: admin.user.id, setToday };
}

test("the target card shows the base, the bonus and its cases", async (context) => {
  const { setToday } = await setup(context);
  setToday(680);
  const data: TodayData = await (await fetch("/api/today")).json();
  const ready = data.target.status === "ready" ? data.target : null;
  assert.ok(ready);
  const card = (bonus: Partial<Bonus>, basis = ready.basis) =>
    text(
      createElement(TargetCard, {
        today: {
          ...data,
          target: { ...ready, basis, bonus: { ...ready.bonus, ...bonus } },
        },
      }),
    );
  for (const [bonus, line] of [
    [
      {},
      "Formula target, still learning</p><p>Base 2,130. +250 from activity.",
    ],
    [{}, "Oura 680 kcal, synced Jan 1, 8:00 PM</p>"],
    [{ mode: "next-day" }, "Base 2,130. +250 from yesterday's activity."],
    [{ kcal: 500, capped: true }, "+500 from activity (capped)."],
    [
      { kcal: 500, capped: true, mode: "next-day" },
      "+500 from yesterday's activity (capped).",
    ],
    [{ kcal: 0, burn_kcal: 120 }, "Base 2,130.</p><p>Oura 120 kcal"],
    [{ status: "waiting" }, "Activity: waiting for today's data."],
    [
      { status: "waiting", mode: "next-day" },
      "Activity: waiting for yesterday's data.",
    ],
    [{ status: "no_source" }, "Activity bonus after 14 days of tracker data."],
    [{ last_synced_at: null }, "Oura 680 kcal</p>"],
  ] as const)
    assert.ok(card(bonus).includes(line), line);
  assert.match(card({}), /2,380 kcal/);
  assert.match(card({}, "weekly_adaptive"), /Adaptive target.*Base 2,130/s);
});

test("an Oura change with no browser action updates the target and Body cards at the next interval", async (context) => {
  const { person, setToday } = await setup(context);
  setToday(680);
  environmentManager.setIsServer(() => false);
  context.after(() => environmentManager.setIsServer(() => true));
  context.mock.timers.enable({ apis: ["setInterval"] });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const queries = [todayQuery(person), signalsQuery(person, day)] as const;
  const keep = [
    new QueryObserver(client, queries[0]).subscribe(() => {}),
    new QueryObserver(client, queries[1]).subscribe(() => {}),
  ];
  context.after(() => {
    for (const stop of keep) stop();
  });
  const loaded = (check: (data: string) => boolean) =>
    new Promise<void>((resolve) => {
      const ready = () =>
        queries.every(({ queryKey }) => {
          const state = client.getQueryState(queryKey);
          return (
            state?.status === "success" &&
            state.fetchStatus === "idle" &&
            check(JSON.stringify(state.data))
          );
        });
      const stop = client.getQueryCache().subscribe(() => {
        if (!ready()) return;
        stop();
        resolve();
      });
    });
  await loaded(() => true);
  const cards = () =>
    text(
      createElement("div", null, [
        createElement(TargetCard, {
          key: "target",
          today: client.getQueryData(todayQuery(person).queryKey) as TodayData,
        }),
        createElement(BodyCard, { key: "body", person, day, online: true }),
      ]),
      client,
    );
  assert.match(
    cards(),
    /\+250 from activity.*Active calories<\/dt><dd>680 kcal/s,
  );
  setToday(1030);
  const updated = loaded((data) => data.includes("1030"));
  context.mock.timers.tick(15 * 60_000);
  assert.equal(client.isFetching(), 2);
  await updated;
  assert.match(
    cards(),
    /\+500 from activity \(capped\).*Active calories<\/dt><dd>1,030 kcal/s,
  );
});
