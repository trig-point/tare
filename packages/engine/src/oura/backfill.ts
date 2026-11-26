import { setTimeout } from "node:timers/promises";
import {
  type Endpoint,
  fetchOura,
  mapOura,
  type OuraFailure,
  type OuraFetchOptions,
} from "@tare/health-sources";
import type { Database } from "better-sqlite3";
import { writeTransaction } from "../db.ts";
import { localDay } from "../logging/day.ts";
import { OperationError } from "../operations/registry.ts";
import { selectEarliestOuraDay } from "../queries/oura/select-earliest-oura-day.ts";
import type { OuraService } from "./service.ts";
import { syncWindowStart, writeSignalsAndSleep } from "./sync.ts";

const sleepEndpoints: Endpoint[] = ["daily_sleep", "sleep", "daily_readiness"];
const timeoutMilliseconds = 120_000;

export interface OuraBackfillResult {
  days_written: number;
  first_day: string | null;
  last_day: string | null;
}

const failureStatus = {
  oura_rate_limited: 503,
  oura_unavailable: 503,
  oura_invalid_response: 503,
  oura_unauthorized: 409,
  oura_membership_required: 409,
} as const satisfies Record<OuraFailure, 503 | 409>;

/**
 * Reads sleep, HRV, resting heart rate and readiness from `since` up to the
 * earliest held day, capped at the sync window start, so it never overlaps
 * the hourly sync's days.
 */
export async function backfillOura({
  database,
  oura,
  clock,
  person,
  since,
  fetch,
  baseUrl,
  wait,
}: {
  database: Database;
  oura: Pick<OuraService, "refreshAccess">;
  clock: { now(): Date };
  person: { id: number; timezone: string; day_start_hour: number };
  since: string;
} & Partial<
  Pick<OuraFetchOptions, "fetch" | "baseUrl" | "wait">
>): Promise<OuraBackfillResult> {
  const empty = { days_written: 0, first_day: null, last_day: null };
  const today = localDay(
    clock.now().toISOString(),
    person.timezone,
    person.day_start_hour,
  );
  const windowStart = syncWindowStart(today);
  const held = selectEarliestOuraDay(database, { user_id: person.id })?.day;
  const end = held && held < windowStart ? held : windowStart;
  if (since >= end) return empty;
  const access = await oura.refreshAccess(person.id);
  const signal = AbortSignal.timeout(timeoutMilliseconds);
  let fetched: Awaited<ReturnType<typeof fetchOura>>;
  try {
    fetched = await fetchOura({
      accessToken: access.accessToken,
      startDate: since,
      endDate: end,
      endpoints: sleepEndpoints,
      signal,
      wait:
        wait ??
        ((milliseconds, waitSignal) =>
          setTimeout(milliseconds, undefined, { signal: waitSignal })),
      ...(fetch ? { fetch } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    });
  } catch {
    fetched = "oura_unavailable";
  }
  if (typeof fetched === "string")
    throw new OperationError(failureStatus[fetched], fetched);
  const mapped = mapOura(fetched);
  // Oura can return records outside the requested range; keep the held days untouched.
  const inRange = (day: string) => day >= since && day < end;
  const days = writeTransaction(database, () =>
    writeSignalsAndSleep(
      database,
      person.id,
      {
        daily: mapped.daily.filter((entry) => inRange(entry.day)),
        sleepPeriods: mapped.sleepPeriods.filter((period) =>
          inRange(period.day),
        ),
      },
      clock.now().toISOString(),
    ),
  );
  const sorted = [...days].sort();
  return {
    days_written: sorted.length,
    first_day: sorted[0] ?? null,
    last_day: sorted.at(-1) ?? null,
  };
}
