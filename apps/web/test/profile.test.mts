import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { twoUsers } from "../../../packages/engine/test/support/two-users.ts";
import { formatBodyWeight, heightToCm, weightToKg } from "../src/body-units.ts";
import {
  chartData,
  historyKey,
  profileKey,
  profileValues,
  readHistory,
  readProfile,
  saveProfile,
} from "../src/profile-api.ts";
import { readToday } from "../src/today-api.ts";
import { test } from "./support.mts";
import "./tsx.mts";

const {
  ProfileForm,
  ProfileSection,
  TargetCard,
  WeightChart,
  watchColorScheme,
} = await import("../src/profile.tsx");
const signal = new AbortController().signal;
const render = (
  node: ReactElement,
  data: [readonly unknown[], unknown][] = [],
) => {
  const client = new QueryClient();
  for (const [key, value] of data) client.setQueryData(key, value);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, node),
  );
};
const profile = {
  height_cm: "170",
  birth_date: "1990-05-01",
  sex: "female",
  activity_level: "moderate",
  goal_rate_kg_week: "-0.5",
  protein_factor: "1.6",
} as const;
async function engine(context: TestContext) {
  const { admin } = await twoUsers(context, "fallback");
  context.mock.method(globalThis, "fetch", admin.request);
  const post = async (path: string, body: object) =>
    assert.ok(
      (await fetch(path, { method: "POST", body: JSON.stringify(body) })).ok,
    );
  return { person: admin.user.id, post };
}

test("profile form saves and edits", async (context) => {
  await engine(context);
  assert.equal(await readProfile(signal), null);
  await saveProfile(profile);
  await saveProfile({ ...profile, height_cm: "172", activity_level: "light" });
  const saved = await readProfile(signal);
  assert.deepEqual(profileValues(saved), {
    ...profile,
    units: "metric",
    height_cm: "172",
    activity_level: "light",
  });
  const form = render(
    createElement(ProfileForm, { person: 1, profile: saved, online: true }),
  );
  assert.match(form, /id="profile-height_cm"[^>]*value="172"/);
  assert.match(form, /<option value="light" selected="">/);
  for (const key of ["goal_rate_kg_week", "protein_factor"])
    assert.match(
      form,
      new RegExp(
        `id="profile-${key}"[^>]*step="any"|step="any"[^>]*id="profile-${key}"`,
      ),
    );
  const fresh = render(
    createElement(ProfileForm, { person: 1, profile: null, online: true }),
  );
  assert.match(fresh, /<option value="" disabled="" selected="">Choose</);
});

test("target card renders target, eaten and remaining from a test engine", async (context) => {
  const { post } = await engine(context);
  const card = async () =>
    render(createElement(TargetCard, { today: await readToday(signal) }));
  assert.match(await card(), /Add your profile to get a target/);
  await saveProfile(profile);
  assert.match(await card(), /Log a weigh-in to get a target/);
  await post("/api/weights", {
    client_id: "example-weight",
    weight_kg: 70,
    measured_at: "2025-12-31T23:00:00.000Z",
  });
  await post("/api/intake", {
    client_id: "example-meal",
    name: "Example meal",
    kcal: 500,
    protein_g: 30,
  });
  const today = await readToday(signal);
  assert.equal(today.target.status, "ready");
  if (today.target.status !== "ready") return;
  const html = await card();
  for (const [goal, left, unit] of [
    [today.target.kcal, today.target.kcal - 500, "kcal"],
    [today.target.protein_g, today.target.protein_g - 30, "g"],
  ] as const) {
    const cell = (value: number) =>
      `<td>${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} ${unit}</td>`;
    assert.ok(html.includes(cell(goal)), `target ${unit}`);
    assert.ok(html.includes(cell(left)), `remaining ${unit}`);
  }
  assert.match(html, /<td>500<\/td>.*<td>30<\/td>/s);
});

test("learning state shown beside the formula target", async (context) => {
  const { post } = await engine(context);
  await saveProfile(profile);
  await post("/api/weights", { client_id: "example-weight", weight_kg: 70 });
  const today = await readToday(signal);
  assert.match(
    render(createElement(TargetCard, { today })),
    /Formula target, still learning<\/p><p>Activity bonus after 14 days/,
  );
  assert.ok(today.target.status === "ready");
  const bonus = { ...today.target.bonus, status: "ready", kcal: 250 } as const;
  const basis = "weekly_adaptive" as const;
  const target = { ...today.target, basis, kcal: 2380, base_kcal: 2130, bonus };
  assert.match(
    render(createElement(TargetCard, { today: { ...today, target } })),
    /Adaptive target.*Base 2,130\. \+250 from activity.*2,380 kcal/s,
  );
});

test("chart data holds each day's first reading and the trend line", async (context) => {
  const { post } = await engine(context);
  for (const [clientId, weight_kg, measured_at] of [
    ["example-a", 80, "2025-12-01T08:00:00.000Z"],
    ["example-b", 79, "2025-12-01T20:00:00.000Z"],
    ["example-c", 81, "2025-12-03T08:00:00.000Z"],
  ] as const)
    await post("/api/weights", { client_id: clientId, weight_kg, measured_at });
  const [days, ...series] = chartData(await readHistory(signal)).map((values) =>
    Array.from(values),
  );
  assert.deepEqual(
    days?.map((seconds) =>
      new Date(Number(seconds) * 1000).toISOString().slice(0, 10),
    ),
    ["2025-12-01", "2025-12-02", "2025-12-03"],
  );
  assert.deepEqual(series, [
    [80, null, 81],
    [80, 80, 80.1],
  ]);
});

test("weight chart shows an empty state with no weigh-ins", async (context) => {
  const { person } = await engine(context);
  const history = await readHistory(signal);
  const chart = render(createElement(WeightChart, { person, online: true }), [
    [historyKey(person), history],
  ]);
  assert.match(chart, /No weigh-ins yet/);
  assert.doesNotMatch(chart, /weight-chart/);
});

test("weight section shows the latest weigh-in, the trend and weigh-ins newest first", () => {
  const days = [
    { day: "2025-06-01", reading_kg: 82, trend_kg: 82 },
    { day: "2025-11-29", reading_kg: 81.9, trend_kg: 81.9 },
    { day: "2025-11-30", reading_kg: 81.5, trend_kg: 81.8 },
    { day: "2025-12-01", reading_kg: null, trend_kg: 81.7 },
  ];
  const readings = [
    { id: 1, day: "2025-06-01", weight_kg: 82, note: null },
    { id: 2, day: "2025-11-29", weight_kg: 81.9, note: null },
    { id: 3, day: "2025-11-30", weight_kg: 81.5, note: "clothed" },
    { id: 4, day: "2025-11-30", weight_kg: 81.6, note: null },
  ];
  const chart = render(
    createElement(WeightChart, { person: 1, online: true }),
    [[historyKey(1), { days, readings }]],
  );
  assert.match(chart, /81\.5 <small[^>]*>kg.*Weigh-in, Nov 30, 2025/s);
  assert.match(chart, /81\.7 <small[^>]*>kg.*Trend/s);
  assert.match(chart, /aria-pressed="true"[^>]*>3M</);
  const rows = [
    ...chart.matchAll(/<li[^>]*><div[^>]*><span[^>]*>([\d.]+) kg/g),
  ];
  assert.deepEqual(
    rows.map((match) => match[1]),
    ["81.6", "81.5", "81.9"],
  );
  assert.match(chart, /81\.5 kg<\/span><p[^>]*>clothed<\/p>/);
  assert.doesNotMatch(chart, />82 kg/);
});

test("a failed refetch keeps the loaded weights beside the error", () => {
  const client = new QueryClient();
  const days = [{ day: "2025-11-30", reading_kg: 81.5, trend_kg: 81.8 }];
  client.setQueryData(historyKey(1), { days, readings: [] });
  client
    .getQueryCache()
    .find({ queryKey: historyKey(1) })
    ?.setState({ status: "error", error: new Error("refetch failed") });
  const chart = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(WeightChart, { person: 1, online: true }),
    ),
  );
  assert.match(chart, /Couldn’t load weights/);
  assert.match(chart, /81\.5 <small/);
});

test("profile summary lists the saved fields, or asks for a profile", () => {
  const section = (profile: unknown) =>
    render(createElement(ProfileSection, { person: 1, online: true }), [
      [profileKey(1), profile],
    ]);
  const summary = section({
    height_cm: 170,
    birth_date: "1990-05-01",
    sex: "female",
    activity_level: "moderate",
    goal_rate_kg_week: -0.5,
    protein_factor: 1.6,
  });
  assert.match(summary, /170 cm<\/span> \/ Female \/ Moderate activity/);
  for (const value of ["May 1, 1990", "-0.5 kg/week", "1.6 g/kg"])
    assert.ok(summary.includes(value), value);
  assert.match(section(null), /Add your profile to get a target/);
});

test("charts rebuild when the color scheme or data-theme changes, until stopped", () => {
  const media = new EventTarget();
  const observers: { notify: () => void; disconnected: boolean }[] = [];
  class FakeObserver {
    entry: { notify: () => void; disconnected: boolean };
    constructor(callback: () => void) {
      this.entry = { notify: callback, disconnected: false };
      observers.push(this.entry);
    }
    observe(_target: unknown, options: { attributeFilter: string[] }) {
      assert.deepEqual(options.attributeFilter, ["data-theme"]);
    }
    disconnect() {
      this.entry.disconnected = true;
    }
  }
  const view = {
    matchMedia: () => media,
    MutationObserver: FakeObserver,
    document: { documentElement: {} },
  } as unknown as typeof globalThis;
  let rebuilds = 0;
  const stop = watchColorScheme(view, () => rebuilds++);
  media.dispatchEvent(new Event("change"));
  observers[0]?.notify();
  assert.equal(rebuilds, 2);
  stop();
  media.dispatchEvent(new Event("change"));
  assert.equal(rebuilds, 2);
  assert.equal(observers[0]?.disconnected, true);
});

test("imperial weight chart displays 103.2 kg as 227.5 lb", () => {
  const days = [{ day: "2025-11-30", reading_kg: 103.2, trend_kg: 103.2 }];
  const chart = render(
    createElement(WeightChart, { person: 1, online: true, units: "imperial" }),
    [[historyKey(1), { days, readings: [] }]],
  );
  assert.match(chart, /227\.5 <small[^>]*>lb/);
});

test("imperial height is saved in cm and metric edits keep the preference", async (context) => {
  await engine(context);
  const height_cm = String(heightToCm(6, 1));
  await saveProfile({ ...profile, height_cm, units: "imperial" });
  const saved = await saveProfile({ ...profile, height_cm });
  assert.equal(saved.height_cm, 185.4);
  assert.equal(saved.units, "imperial");
});

test("stored weight round-trips within half the display increment", () => {
  const decimal = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  });
  for (let sample = 1; sample <= 1000; sample += 1) {
    const kg = ((sample * 16807) % 500003) / 1000;
    const displayed = Math.round((kg / 0.45359237) * 10) / 10;
    assert.equal(formatBodyWeight(kg, "imperial"), decimal.format(displayed));
    assert.ok(
      Math.abs(weightToKg(displayed, "imperial") - kg) <= 0.05 * 0.45359237,
    );
  }
});
