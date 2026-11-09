import { setImmediate, setTimeout } from "node:timers/promises";
import {
  fetchOura,
  mapOura,
  type OuraFetchOptions,
} from "@tare/health-sources";
import type { Database } from "better-sqlite3";
import { writeTransaction } from "../db.ts";
import { localDay, shiftDay } from "../logging/day.ts";
import { listSyncPeople } from "../queries/oura/list-sync-people.ts";
import { markMembership } from "../queries/oura/mark-membership.ts";
import { markReconnect } from "../queries/oura/mark-reconnect.ts";
import { recordSync } from "../queries/oura/record-sync.ts";
import { selectConnection } from "../queries/oura/select-connection.ts";
import { upsertSignal } from "../queries/upsert-signal.ts";
import { upsertSleepPeriod } from "../queries/upsert-sleep-period.ts";
import { upsertSourceActivity } from "../queries/upsert-source-activity.ts";
import { countUnknownKinds } from "../signals/activity-kinds.ts";
import { metricName, signalVocabulary } from "../signals/vocabulary.ts";
import type { OuraService } from "./service.ts";

const backfillDays = 30;
// Sleep can reach Oura days after the night, so each run re-reads a few days.
const overlapDays = 3;

export function createOuraSyncJob({
  database,
  oura,
  clock,
  fetch,
  wait = (milliseconds, signal) =>
    setTimeout(milliseconds, undefined, { signal }),
  baseUrl,
}: {
  database: Database;
  oura: Pick<OuraService, "refreshAccess">;
  clock: { now(): Date };
} & Partial<Pick<OuraFetchOptions, "fetch" | "wait" | "baseUrl">>) {
  async function syncPerson(
    person: ReturnType<typeof listSyncPeople>[number],
    signal: AbortSignal,
  ) {
    const owner = person.user_id;
    const access = await oura.refreshAccess(owner);
    const local = (instant: string) =>
      localDay(instant, person.timezone, person.day_start_hour);
    const today = local(clock.now().toISOString());
    const earliest = shiftDay(today, 1 - backfillDays);
    const resume = person.last_synced_at
      ? shiftDay(local(person.last_synced_at), -overlapDays)
      : earliest;
    const fetched = await fetchOura({
      accessToken: access.accessToken,
      startDate: resume > earliest ? resume : earliest,
      endDate: shiftDay(today, 1),
      ...(person.scores_backfilled_at
        ? {}
        : {
            startDates: { daily_sleep: earliest, daily_stress: earliest },
          }),
      signal,
      wait,
      ...(fetch ? { fetch } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    });
    if (typeof fetched === "string") {
      if (fetched === "oura_membership_required")
        writeTransaction(database, () =>
          markMembership(
            database,
            { now: clock.now().toISOString() },
            { user_id: owner },
          ),
        );
      // An unexpired token that is still the stored one proves the grant is
      // gone; an expired or replaced token only needs the next refresh.
      if (fetched === "oura_unauthorized")
        writeTransaction(database, () => {
          const current = selectConnection(database, { user_id: owner });
          if (
            current &&
            current.access_expires_at === access.accessExpiresAt &&
            Date.parse(access.accessExpiresAt) > clock.now().getTime()
          )
            markReconnect(database, {
              user_id: owner,
              generation: current.generation,
            });
        });
      throw new Error(fetched);
    }
    const mapped = mapOura(fetched);
    signal.throwIfAborted();
    writeTransaction(database, () => {
      const now = clock.now().toISOString();
      const source = { user_id: owner, source: "oura" };
      for (const entry of mapped.daily) {
        const metric = metricName.safeParse(entry.metric);
        if (
          !metric.success ||
          !signalVocabulary[metric.data].value.safeParse(entry.value).success
        )
          continue;
        upsertSignal(database, { ...entry, ...source, updated_at: now });
      }
      for (const period of mapped.sleepPeriods)
        upsertSleepPeriod(database, {
          ...source,
          source_record_id: period.recordId,
          day: period.day,
          started_at: period.startedAt,
          ended_at: period.endedAt,
          sleep_minutes: period.sleepMinutes,
          kind: period.kind,
          updated_at: now,
        });
      for (const session of mapped.sessions)
        upsertSourceActivity(database, {
          ...source,
          source_record_id: session.recordId,
          day: local(session.startedAt),
          started_at: session.startedAt,
          duration_minutes: session.durationMinutes,
          kind: session.kind,
          calories: session.calories,
          created_at: now,
        });
      countUnknownKinds(
        mapped.sessions.map((session) => session.kind),
        "oura",
      );
      if (!recordSync(database, { now }, { user_id: owner }))
        throw new Error("oura_sync_not_recorded");
    });
  }

  async function run({ signal }: { signal: AbortSignal }) {
    signal.throwIfAborted();
    let synced = 0;
    let failed = 0;
    for (const person of listSyncPeople(database)) {
      await setImmediate(undefined, { signal });
      try {
        await syncPerson(person, signal);
        synced++;
      } catch (error) {
        if (signal.aborted) throw error;
        failed++;
        console.error(
          "oura_sync_failed",
          person.user_id,
          error instanceof Error ? error.message.slice(0, 40) : "unknown",
        );
      }
    }
    const result = `oura_synced:${synced}`;
    if (failed) {
      console.error(`${result} failed:${failed}`);
      throw new Error("Oura sync failed");
    }
    return result;
  }
  return { name: "oura-sync", schedule: "0 7 * * *", run };
}
