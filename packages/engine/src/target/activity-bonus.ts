import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import type { Config } from "../config.ts";
import { shiftDay } from "../logging/day.ts";
import { selectLastSync } from "../queries/oura/select-last-sync.ts";
import { selectSignalHistory } from "../queries/select-signal-history.ts";

// Hand-entered burn (manual, agent) is never on this list.
const eligibleTrackers = ["oura"] as const;
const averageDays = 28;
const minimumDays = 14;

export type BonusSettings = Pick<Config, "activityCredit" | "activityBonusCap">;

export const bonusSchema = zod.strictObject({
  status: zod.enum(["ready", "waiting", "no_source"]),
  kcal: zod.number().int(),
  capped: zod.boolean(),
  mode: zod.enum(["same-day", "next-day"]),
  day: zod.string(),
  source: zod.enum(eligibleTrackers).nullable(),
  burn_kcal: zod.number().nullable(),
  average_kcal: zod.number().nullable(),
  last_synced_at: zod.string().nullable(),
});

export function activityBonus(
  database: Database,
  owner: { user_id: number; today: string },
  settings: BonusSettings,
): zod.infer<typeof bonusSchema> {
  const mode = settings.activityCredit;
  const day = mode === "same-day" ? owner.today : shiftDay(owner.today, -1);
  const none = {
    status: "no_source",
    kcal: 0,
    capped: false,
    mode,
    day,
    source: null,
    burn_kcal: null,
    average_kcal: null,
    last_synced_at: null,
  } as const;
  const burn = selectSignalHistory(database, {
    user_id: owner.user_id,
    from: shiftDay(day, -averageDays),
    to: day,
  }).filter((row) => row.metric === "active_calories");
  for (const source of eligibleTrackers) {
    const rows = burn.filter((row) => row.source === source);
    if (rows.length === 0) continue;
    const history = rows.filter((row) => row.day < day);
    if (history.length < minimumDays) return { ...none, source };
    const average =
      history.reduce((sum, row) => sum + row.value, 0) / history.length;
    const credited = rows.find((row) => row.day === day);
    const found = {
      ...none,
      source,
      average_kcal: average,
      last_synced_at:
        selectLastSync(database, { user_id: owner.user_id })?.last_synced_at ??
        null,
    };
    if (!credited) return { ...found, status: "waiting" };
    const extra = Math.max(0, credited.value - average);
    return {
      ...found,
      status: "ready",
      burn_kcal: credited.value,
      kcal: Math.round(Math.min(extra, settings.activityBonusCap)),
      capped: extra > settings.activityBonusCap,
    };
  }
  return none;
}
