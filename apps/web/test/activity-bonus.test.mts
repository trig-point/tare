import assert from "node:assert/strict";
import { signalsQuery } from "../src/health-api.ts";
import { planQuery } from "../src/plan-api.ts";
import { type Bonus, bonusLines, todayQuery } from "../src/today-api.ts";
import { test } from "./support.mts";

test("the target card's bonus lines: bonus, next-day, capped, quiet, waiting and no source", () => {
  const ready: Bonus = {
    status: "ready",
    kcal: 250,
    capped: false,
    mode: "same-day",
    day: "2026-01-01",
    source: "oura",
    burn_kcal: 680,
    average_kcal: 430,
    last_synced_at: "2026-01-01T14:30:00.000Z",
  };
  const next = { mode: "next-day" } as const;
  const cases: Partial<Bonus>[] = [
    {},
    { ...next, kcal: 500, capped: true, last_synced_at: null },
    { kcal: 0, burn_kcal: 120 },
    { status: "waiting" },
    { ...next, status: "waiting" },
    { status: "no_source" },
  ];
  assert.deepEqual(
    cases.map((bonus) => bonusLines(2130, { ...ready, ...bonus }, "UTC")),
    [
      [
        "Base 2,130. +250 from activity.",
        "Oura 680 kcal, synced Jan 1, 2:30 PM",
      ],
      ["Base 2,130. +500 from yesterday's activity (capped).", "Oura 680 kcal"],
      ["Base 2,130.", "Oura 120 kcal, synced Jan 1, 2:30 PM"],
      ["Activity: waiting for today's data."],
      ["Activity: waiting for yesterday's data."],
      ["Activity bonus after 14 days of tracker data."],
    ],
  );
});

test("today, plan and signals refetch on focus and every 15 minutes", () => {
  for (const query of [
    todayQuery(1),
    planQuery(1),
    signalsQuery(1, "2026-01-01"),
  ])
    assert.deepEqual(
      [query.refetchInterval, query.refetchOnWindowFocus],
      [15 * 60_000, true],
    );
});
