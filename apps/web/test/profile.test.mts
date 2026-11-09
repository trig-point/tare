import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { twoUsers } from "../../../packages/engine/test/support/two-users.ts";
import {
  chartData,
  historyKey,
  profileValues,
  readHistory,
  readProfile,
  saveProfile,
} from "../src/profile-api.ts";
import { readToday } from "../src/today-api.ts";
import { test } from "./support.mts";
import "./tsx.mts";

const { ProfileForm, TargetCard, WeightChart } = await import(
  "../src/profile.tsx"
);
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
async function engine(context: Parameters<typeof twoUsers>[0]) {
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
  const target = { ...today.target, kcal: 2380, base_kcal: 2130, bonus };
  const bonused = render(
    createElement(TargetCard, { today: { ...today, target } }),
  );
  assert.match(bonused, /Base 2,130\. \+250 from activity/);
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
