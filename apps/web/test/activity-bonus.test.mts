import assert from "node:assert/strict";
import { signalsQuery } from "../src/health-api.ts";
import { planQuery } from "../src/plan-api.ts";
import { type Bonus, bonusLines, todayQuery } from "../src/today-api.ts";
import { test } from "./support.mts";

test("the target card's bonus, quiet, capped and waiting lines, and refetch every 15 minutes", () => {
  const ready: Bonus = JSON.parse(
    '{"status":"ready","kcal":250,"capped":false,"mode":"same-day","day":"2026-01-01","source":"oura","burn_kcal":680,"average_kcal":430,"last_synced_at":"2026-01-01T14:30:00.000Z"}',
  );
  const next = { mode: "next-day" } as const;
  for (const [bonus, line] of [
    [{}, "Base 2,130. +250 from activity."],
    [{ kcal: 0 }, "Base 2,130."],
    [
      { ...next, kcal: 500, capped: true },
      "Base 2,130. +500 from yesterday's activity (capped).",
    ],
    [{ status: "waiting" }, "Activity: waiting for today's data."],
    [{ ...next, status: "waiting" }, "Activity: waiting for yesterday's data."],
  ] as const)
    assert.equal(bonusLines(2130, { ...ready, ...bonus }, "UTC")[0], line);
  const [, burn] = bonusLines(2130, ready, "UTC");
  assert.equal(burn, "Oura 680 kcal, synced Jan 1, 2:30 PM");
  const unsynced = { ...ready, last_synced_at: null };
  assert.equal(bonusLines(2130, unsynced, "UTC")[1], "Oura 680 kcal");
  const live = [todayQuery(1), planQuery(1), signalsQuery(1, "2026-01-01")];
  for (const { refetchInterval, refetchOnWindowFocus } of live)
    assert.deepEqual([refetchInterval, refetchOnWindowFocus], [900_000, true]);
});
