import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadConfig } from "../../../packages/engine/src/config.ts";
import { cookie, fixture } from "../../../packages/engine/test/auth-support.ts";
import { twoUsers } from "../../../packages/engine/test/support/two-users.ts";
import * as health from "../src/health-api.ts";
import type { OutboxReplay } from "../src/outbox-replay.ts";
import { accountKey } from "../src/settings-api.ts";
import { readToday, todayKey } from "../src/today-api.ts";
import { test } from "./support.mts";
import "./tsx.mts";

const { Today } = await import("../src/today.tsx");
const { BodyCard, ConnectedSources } = await import("../src/health.tsx");
const { AccountSettings } = await import("../src/settings.tsx");
function withData(data: [readonly unknown[], unknown][], node: ReactElement) {
  const client = new QueryClient();
  for (const [key, value] of data) client.setQueryData(key, value);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, node),
  );
}
const oura = (connection: Partial<health.OuraConnection>) =>
  health.ouraSchema.parse({
    ...{ configured: true, status: "connected", credentials: "readable" },
    ...{ last_synced_at: null, ...connection },
  });
const renderOura = (
  connection: Partial<health.OuraConnection>,
  callbackResult: string | null = null,
) =>
  withData(
    [[health.ouraKey(1), oura(connection)]],
    createElement(ConnectedSources, {
      person: 1,
      timezone: "UTC",
      online: true,
      callbackResult,
    }),
  );

test("today renders the Body card beside intake and no Oura card", async (context) => {
  const { admin } = await twoUsers(context, "fallback");
  context.mock.method(globalThis, "fetch", admin.request);
  for (const [path, body] of [
    ["/api/intake", { client_id: "example-food", name: "Meal", kcal: 200 }],
    ["/api/signals", { metric: "active_calories", value: 420 }],
  ] as const)
    assert.ok(
      (await fetch(path, { method: "POST", body: JSON.stringify(body) })).ok,
    );
  const today = await readToday(new AbortController().signal);
  const signals = await health.readSignals(
    today.day,
    new AbortController().signal,
  );
  const renderDay = (
    day: health.Signals,
    connection: Partial<health.OuraConnection> = { status: null },
  ) =>
    withData(
      [
        [todayKey(admin.user.id), today],
        [health.signalsKey(admin.user.id, today.day), day],
        [health.ouraKey(admin.user.id), oura(connection)],
      ],
      createElement(Today, {
        person: admin.user,
        records: [],
        online: false,
        replay: {} as OutboxReplay,
      }),
    );
  assert.match(
    renderDay(signals),
    /class="day-summary".*Calories<\/dt><dd>200<.*Active calories<\/dt><dd>420 kcal</s,
  );
  const empty = renderDay({ ...signals, signals: [] });
  assert.match(empty, /<a href="#settings">Connect a source in Settings</);
  assert.doesNotMatch(empty, /Connect Oura|Connected sources/);
  const blocked = renderDay(
    { ...signals, signals: [] },
    { status: "membership_required" },
  );
  assert.match(blocked, /No signals/);
  assert.doesNotMatch(blocked, /#settings/);
});

test("connect starts the Oura flow at the authorization URL", async (context) => {
  const setup = fixture(context, {
    config: loadConfig({
      DATABASE_URL: ":memory:",
      TARE_OURA_CLIENT_ID: "invented-client",
      TARE_OURA_CLIENT_SECRET: "invented-secret",
      TARE_OURA_REDIRECT_URL: "https://tare.example.test/api/oura/callback",
      TARE_OURA_TOKEN_KEY: Buffer.alloc(32, 7).toString("base64"),
    }),
  });
  const session = cookie(await setup.signIn());
  const withCookie = (init: RequestInit) => {
    const headers = new Headers(init.headers);
    headers.set("Cookie", session);
    return { ...init, headers };
  };
  context.mock.method(globalThis, "fetch", (path: string, init: RequestInit) =>
    setup.app.request(path, withCookie(init)),
  );
  const visited: string[] = [];
  await health.connectOura((url) => visited.push(url));
  const [url] = visited.map((href) => new URL(href));
  assert.equal(visited.length, 1);
  assert.equal(
    url?.href.split("?")[0],
    "https://cloud.ouraring.com/oauth/authorize",
  );
  assert.equal(url?.searchParams.get("client_id"), "invented-client");
  const disconnected = renderOura({ status: null, credentials: null });
  assert.match(disconnected, /<button[^>]*>Connect Oura</);
});

test("connected state shows the last-sync time", () => {
  const syncedAt = "2026-01-02T08:30:00.000Z";
  const shown = new Date(syncedAt).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const html = renderOura({ last_synced_at: syncedAt });
  assert.match(html, /Oura connected/);
  assert.ok(
    html.includes(`Last synced <time dateTime="${syncedAt}">${shown}<`),
  );
  assert.match(renderOura({}), /Not synced yet/);
  assert.equal(renderOura({ configured: false }), "");
});

test("membership and authorization errors render differently", () => {
  const membership = renderOura({ status: "membership_required" });
  assert.match(membership, /Oura membership required/);
  assert.doesNotMatch(membership, /Reconnect|button/);
  const authorization = renderOura({ status: "reconnect_required" });
  assert.match(authorization, /Oura sign-in expired.*Reconnect Oura/s);
  assert.doesNotMatch(authorization, /membership/);
});

test("a connect that shared no data asks to allow Daily on reconnect", () => {
  const html = renderOura({ status: "reconnect_required" }, "no_data");
  assert.match(html, /Allow Daily when you reconnect Oura.*Reconnect Oura/s);
  assert.doesNotMatch(html, /sign-in expired/);
});

test("a connection needing reconnect after a restore says so", () => {
  for (const status of ["connected", "membership_required"] as const)
    assert.match(
      renderOura({ status, credentials: "unreadable" }),
      /Oura needs reconnecting after a restore.*Reconnect Oura/s,
    );
});

test("a failed Oura read shows an error, not a connection state", () => {
  const client = new QueryClient();
  client
    .getQueryCache()
    .build(client, { queryKey: health.ouraKey(1) })
    .setState({ status: "error", error: new Error("Unavailable") });
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ConnectedSources, {
        person: 1,
        timezone: "UTC",
        online: false,
      }),
    ),
  );
  assert.match(html, /role="alert">Couldn’t load Oura</);
  assert.doesNotMatch(html, /Connect Oura|Oura connected/);
});

test("two sources for one metric render only the preferred one", () => {
  const day = "2026-01-02";
  const steps = { metric: "steps", unit: "count" } as const;
  const html = withData(
    [
      [
        health.signalsKey(1, day),
        health.signalsSchema.parse({
          day,
          activities: [],
          signals: [
            { ...steps, value: 750, source: "manual", why: [] },
            { ...steps, value: 800, source: "oura", why: [] },
            { metric: "hrv", unit: "ms", value: 41, source: "agent", why: [] },
            { metric: "hrv", unit: "ms", value: 45, source: "oura", why: [] },
          ],
        }),
      ],
    ],
    createElement(BodyCard, { person: 1, day, online: false }),
  );
  assert.match(html, /<h2>Body<\/h2>/);
  assert.match(
    html,
    /<dt>HRV<\/dt><dd>45 ms<\/dd><dd class="source">Oura<.*<dt>Steps<\/dt><dd>750<\/dd><dd class="source">Manual</s,
  );
  assert.doesNotMatch(html, /800|41 ms|Agent/);
});

test("the Body card shows each signal's why-lines and every burn source", () => {
  const day = "2026-01-02";
  const burn = { metric: "active_calories", unit: "kcal" } as const;
  const burnLine = "Burn 640 kcal, above your usual 430. You logged a workout.";
  const lateLine =
    "You trained within 4 hours of bed. Late hard workouts are linked to lower HRV.";
  const html = withData(
    [
      [
        health.signalsKey(1, day),
        health.signalsSchema.parse({
          day,
          activities: [],
          signals: [
            { ...burn, value: 640, source: "manual", why: [burnLine] },
            { ...burn, value: 305, source: "oura", why: [] },
            {
              metric: "hrv",
              unit: "ms",
              value: 42,
              source: "oura",
              why: [lateLine],
            },
          ],
        }),
      ],
    ],
    createElement(BodyCard, { person: 1, day, online: false }),
  );
  assert.match(
    html,
    new RegExp(
      `<dt>HRV</dt><dd>42 ms</dd><dd class="source">Oura</dd><dd class="why">${lateLine}</dd>.*` +
        `<dt>Active calories</dt><dd>640 kcal</dd><dd class="source">Manual</dd><dd class="why">${burnLine}</dd>.*` +
        `<dt>Active calories</dt><dd>305 kcal</dd><dd class="source">Oura</dd></div>`,
      "s",
    ),
  );
});

test("Oura scores render in order, with whole minutes and the stress category as text", () => {
  const oura = (
    metric: string,
    unit: string,
    value: number,
    label?: string,
  ) => ({ metric, unit, value, source: "oura", label, why: [] });
  const response = (...signals: unknown[]) => ({
    day: "2026-01-02",
    activities: [],
    signals,
  });
  const rows = health.bodyRows(
    health.signalsSchema.parse(
      response(
        oura("stress_summary", "category", 2, "stressful"),
        oura("stress_high", "minutes", 90.5),
        oura("sleep_score", "score", 81),
      ),
    ).signals,
  );
  assert.deepEqual(
    rows.map(
      (entry) =>
        `${health.metricLabels[entry.metric]} ${health.signalText(entry)}`,
    ),
    ["Sleep score 81", "High stress 91 min", "Stress summary Stressful"],
  );
  assert.ok(
    !health.signalsSchema.safeParse(
      response(oura("stress_summary", "category", 2)),
    ).success,
  );
});

test("settings renders the Oura connection states", () => {
  const account = {
    ...{ id: 1, username: "example-person", timezone: "UTC" },
    ...{ day_start_hour: 4, is_admin: false },
  };
  const html = withData(
    [
      [accountKey(1), account],
      [health.ouraKey(1), oura({ status: "reconnect_required" })],
    ],
    createElement(AccountSettings, {
      session: { mode: "fallback", user: account },
      online: true,
    }),
  );
  assert.match(html, /id="settings".*Connected sources.*Reconnect Oura/s);
});

test("a page restored from the back-forward cache resets connect", () => {
  const page = new EventTarget();
  let resets = 0;
  const stop = health.onPageRestored(page, () => resets++);
  const show = (persisted: boolean) =>
    page.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }));
  show(false);
  assert.equal(resets, 0);
  show(true);
  assert.equal(resets, 1);
  stop();
  show(true);
  assert.equal(resets, 1);
});
