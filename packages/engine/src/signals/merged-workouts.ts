import type { SelectActivitiesResult } from "../queries/select-activities.ts";
import type { SelectActivitySetsResult } from "../queries/select-activity-sets.ts";
import { activityCategory } from "./activity-kinds.ts";

const kgPerPound = 0.45359237;
export const poundsToKg = (pounds: number) => pounds * kgPerPound;
const twoPlaces = (value: number) => Math.round(value * 100) / 100;

export function setView(row: SelectActivitySetsResult) {
  const { session_id: _session, load_kg, ...rest } = row;
  return {
    ...rest,
    load:
      load_kg === null
        ? null
        : twoPlaces(row.load_unit === "lb" ? load_kg / kgPerPound : load_kg),
    load_kg: load_kg === null ? null : twoPlaces(load_kg),
  };
}

const loggedSources = new Set(["manual", "agent"]);
const span = (session: SelectActivitiesResult) => {
  const start = Date.parse(session.started_at ?? "");
  return { start, end: start + (session.duration_minutes ?? 0) * 60_000 };
};
const overlapOf = (
  first: SelectActivitiesResult,
  second: SelectActivitiesResult,
) => {
  const [one, two] = [span(first), span(second)];
  return Math.min(one.end, two.end) - Math.max(one.start, two.start);
};

export function mergeWorkouts(
  sessions: SelectActivitiesResult[],
  sets: SelectActivitySetsResult[],
) {
  const setsBySession = Map.groupBy(sets, (row) => row.session_id);
  const pairable = (session: SelectActivitiesResult) =>
    session.timing === "exact" &&
    activityCategory(session.kind).category !== "other";
  const logged = sessions
    .filter((session) => loggedSources.has(session.source) && pairable(session))
    .sort((first, second) => span(first).start - span(second).start);
  const trackers = sessions.filter(
    (session) => !loggedSources.has(session.source) && pairable(session),
  );
  const partner = new Map<number, SelectActivitiesResult>();
  const taken = new Set<number>();
  for (const session of logged) {
    const category = activityCategory(session.kind).category;
    const best = trackers
      .filter(
        (tracker) =>
          !taken.has(tracker.id) &&
          activityCategory(tracker.kind).category === category &&
          overlapOf(session, tracker) > 0,
      )
      .sort(
        (first, second) =>
          overlapOf(session, second) - overlapOf(session, first) ||
          span(first).start - span(second).start ||
          first.id - second.id,
      )[0];
    if (!best) continue;
    partner.set(session.id, best);
    taken.add(best.id);
  }
  return sessions
    .filter((session) => !taken.has(session.id))
    .map((session) => {
      const tracker = partner.get(session.id);
      return {
        ...session,
        category: activityCategory(session.kind).category,
        calories: tracker ? tracker.calories : session.calories,
        tracker: tracker ? { id: tracker.id, source: tracker.source } : null,
        sets: (setsBySession.get(session.id) ?? []).map(setView),
      };
    });
}
