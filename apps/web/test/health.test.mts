import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadConfig } from "../../../packages/engine/src/config.ts";
import { cookie, fixture } from "../../../packages/engine/test/auth-support.ts";
import { twoUsers } from "../../../packages/engine/test/support/two-users.ts";
import * as health from "../src/health-api.ts";
import type { OutboxReplay } from "../src/outbox-replay.ts";
import { readToday, todayKey } from "../src/today-api.ts";
import { test } from "./support.mts";
import "./tsx.mts";

const { Today } = await import("../src/today.tsx");
const { DaySignals, OuraStatus } = await import("../src/health.tsx");
function withData(data: [readonly unknown[], unknown][], node: ReactElement) {
  const client = new QueryClient();
  for (const [key, value] of data) client.setQueryData(key, value);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, node),
  );
}
const renderOura = (
  connection: Partial<health.OuraConnection>,
  callbackResult: string | null = null,
) =>
  withData(
    [
      [
        health.ouraKey(1),
        health.ouraSchema.parse({
          ...{ configured: true, status: "connected", credentials: "readable" },
          ...{ last_synced_at: null, ...connection },
        }),
      ],
    ],
    createElement(OuraStatus, {
      person: 1,
      timezone: "UTC",
      online: true,
      callbackResult,
    }),
  );

test("signals render beside the day's intake from a test engine", async (context) => {
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
  const renderDay = (day: health.Signals) =>
    withData(
      [
        [todayKey(admin.user.id), today],
        [health.signalsKey(admin.user.id, today.day), day],
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
  assert.match(renderDay({ ...signals, signals: [] }), /No signals/);
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
      createElement(OuraStatus, { person: 1, timezone: "UTC", online: false }),
    ),
  );
  assert.match(html, /role="alert">Couldn’t load Oura</);
  assert.doesNotMatch(html, /Connect Oura|Oura connected/);
});

test("one metric from two sources renders as two labelled rows", () => {
  const day = "2026-01-02";
  const row = { metric: "steps", unit: "count" } as const;
  const html = withData(
    [
      [
        health.signalsKey(1, day),
        health.signalsSchema.parse({
          day,
          activities: [],
          signals: [
            { ...row, value: 800, source: "oura" },
            { ...row, value: 750, source: "manual" },
            { metric: "sleep", unit: "minutes", value: 420, source: "oura" },
          ],
        }),
      ],
    ],
    createElement(DaySignals, { person: 1, day, online: false }),
  );
  assert.match(html, /<dt>Steps \(oura\)<\/dt><dd>800</);
  assert.match(html, /<dt>Steps \(manual\)<\/dt><dd>750</);
  assert.match(html, /<dt>Sleep<\/dt>/);
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
