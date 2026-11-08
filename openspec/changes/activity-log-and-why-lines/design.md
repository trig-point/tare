## Context

The `tare-v1` change stores daily signals and activity sessions (`packages/engine/migrations/0011_health_signals.sql`). Oura workouts land in `activity_sessions` with Oura's calorie estimate (`packages/engine/src/oura/sync.ts:118`). Daily burn is the `active_calories` signal, kept per source (`daily_signals` keyed by user, day, metric and source). The Oura sync runs once a day at 7:00 (`sync.ts:159`) and each run reads from three days back through tomorrow, so today's partial activity is already fetched; a 429 backs off and reports `oura_rate_limited` (`packages/health-sources/src/oura-client.ts:120`). The calorie target never reads signals: the weekly job stores an energy-balance target, and today, slot budgets and the Home Assistant sensors read it through one reader (`packages/engine/src/target/reader.ts`). The Body card (`apps/web/src/health.tsx`) lists sessions with their calories; its client schemas (`apps/web/src/health-api.ts`) drop unknown fields and order sources as manual, Oura, agent.

Governing principle from the operator: Tare is the person's health hub and takes in everything. Research on how accurate a source is decides how much weight its reading gets, never whether the reading is used; every source is weighted, shown, and its uncertainty stated. Research behind the numbers here: a 12-device doubly labelled water study put free-living activity-burn error at 19 to 100 percent; Oura's validation (n = 32) found per-person systematic over- or underestimation that grows with intensity; a 15-device BIA study with a four-compartment reference put body fat change-tracking error at 1.7 to 2.6 points; WHOOP member data tied late hard exercise to 14 percent lower HRV and 7 percent higher resting heart rate. Every threshold Tare itself uses (1 standard deviation, 10 percent, 2 points, 4 weeks, 14 days, 5 and 5, the daily cap) is an assumption, not a measured value.

Single person in V1 (every row still carries `user_id`). Raw SQL with generated types, no Kysely. No mutation testing.

## Goals / Non-Goals

**Goals:**
- A training day gets its extra burn in that day's target, while the weekly total stays set by energy balance.
- Workouts with sets, sauna, cold plunge and a few habits are kept as context notes, logged once and read the same way by every consumer.
- When a signal moves, the Body card says what was logged the day or night before, worded as co-occurrence.
- Scale body fat is used and shown with its error, never hidden.

**Non-Goals:**
- The /workout skill writing to Tare: deferred until Cairn hosts an embedded agent surface in apps.
- The routine-change note, post-change window, `routine_changes` table and planned-change prompt: the daily adjustment answers the training-day concern.
- Health Connect import and export (mapping notes below only), significance tests, and any multi-user feature.
- Summing burn across sources.

## Decisions

### The day's target is the weekly target plus an activity adjustment

The weekly target B still comes from energy balance over the 28-day window, recomputed weekly, unchanged. Each day's target is a base plus the day's activity adjustment, which compares today's tracker active burn with the person's usual burn from the same source. Example: usual Oura burn 430 kcal, today 680 kcal; the adjustment is +250 and the card shows "+250 from activity".

Why a relative delta cancels a tracker's consistent bias: the large error in the research applies to absolute values; the delta compares a tracker with itself. A fixed offset cancels completely. A proportional bias shrinks to the size of the departure (a ring reading 20 percent low turns a true +300 day into +240, an error of 60 kcal, not 20 percent of the whole day). Intensity-dependent error under-credits hard days, which errs toward less food. Random day-to-day error does not cancel, which is why there is a cap and why the weekly total is never set by the tracker. This is the research's rejected option 2; the operator chose it with the error stated.

Why energy balance corrects what is left: B is re-measured each week from intake and the scale. If the tracker drifts, the 28-day average follows within 28 days and the delta returns to zero. A lasting rise in activity moves into B through later recomputes while the average rises with it, so a workout is counted once.

Alternatives considered: tracker burn as explanation only (revision 2, replaced by the operator's ruling that fitness data feeds the calculation), adding the full tracker burn (double counting, error up to 100 percent), a fixed percentage per workout kind (no source measured one).

### OPEN: operator choice, the morning and the week's total

Oura's burn for today grows through the day while the average is a full day, so a plain "today minus average" is a large negative number every morning. Two ways to handle that and keep the week's targets averaging to B:

- **Recommended (orchestrator brief): same time of day.** The adjustment is today's burn so far minus the person's usual burn by the same local time of day, the mean over the previous 28 days with samples, in either direction, capped. In the morning it starts near zero; a quiet day lowers the target ("-150 from activity"), and a week off lowers the day's targets as soon as the tracker shows less burn. The base is B. Over a typical week the adjustments average about zero, so the targets average to B. This needs cumulative burn at known times: each sync stores a burn sample (person, source, day, observed time, cumulative active kcal), upserted by person, source and observed minute; task 1.1 checks whether Oura's daily activity carries an intraday timeline that could backfill past days.
- **Alternative (r3's recommendation, its open question 1): base offset.** The adjustment is `max(0, today so far minus the 28-day average)`, capped; it starts at zero and only rises, per the operator's decision that the morning starts at zero. On its own that pushes the week above B (about 80 kcal a day in an illustration, not measured), so the day's base is B minus the 28-day average of the adjustment itself (each past day's final capped adjustment against the same average). The card shows "Base 2,070. +250 from activity." No samples are needed; the daily `active_calories` signal is enough.

r3 recommends the base offset and the brief recommends same time of day, so the operator's choice also settles whether the adjustment may go below zero. The spec carries `OPEN: operator choice` and the rule lives in one function, so either option can be built without changing the reader's response, the card or the tests' shape. Task 1.3 is not built until the operator chooses.

### Cases

- No tracker data today: no adjustment and no offset; the target is B; the card says "No activity data yet."
- A source with readings on fewer than 14 days of the 28-day window: no adjustment and no offset; the card says "Activity adjustment after 14 days of data."
- Several sources: one source per person feeds the adjustment, the first eligible one in a fixed engine-side order matching the client's (manual, Oura, agent). Sources are never summed.
- The cap is unmeasured: configuration with an assumed default of 500 kcal, against a faulty reading. A capped day shows "+500 from activity (capped)".
- Slot budgets and the Home Assistant target sensors read the same reader, so open slots pick up the change. The weekly target notice keeps comparing B.
- A guard test proves HRV, sleep, sessions, session calories and habit notes never change the target, and that active calories change it only through the adjustment.

### Oura sync about hourly

The schedule moves from `0 7 * * *` to `0 * * * *`, the calendar refresh's precedent. Each run already re-reads three days, so an hourly run is the same request set 24 times a day. Before the change ships, task 1.1 records Oura's rate limit against 24 runs a day per person and whether today's daily activity updates during the day; task 1.2 then runs one real hourly sync and keeps the output as evidence.

### Sessions, sets and categories

`activity_sessions` gains nullable `notes`. Sauna and cold plunge are sessions, because their time matters for the night that follows; their kinds are `sauna` and `cold_plunge`. A fixed category list in code maps each kind to `strength`, `cardio`, `sauna`, `cold_plunge` or `other`; Oura's activity strings map through a fixed table, and an unknown string maps to `other` and is counted in telemetry, never rejected. Calories on a session stay the tracker's estimate for that workout, shown on the session row and never added to daily burn, intake or the target.

`activity_sets` holds one row per set, the way Strong and Hevy store it: `user_id`, `session_id` (composite reference to `activity_sessions (user_id, id)`), `set_index` (1 and up), `exercise` (nonblank), `set_type` (`warmup`, `working`, `drop`, `failure`; default `working`), nullable `reps`, `load_kg` (0 or more, always kilograms; pounds converted before storing), `load_unit` (`kg` or `lb`, display only), nullable `duration_seconds`, `rir_low` and `rir_high` (0 to 10, low at most high, since logs record reps in reserve as ranges such as "3-4"), nullable `notes` for uncertain numbers, and `UNIQUE (user_id, session_id, set_index)`.

`log_activity` takes optional `notes` and `sets` and writes session and sets in one transaction; a replay with the same `client_id` returns the stored session and writes nothing. `replace_activity_sets` replaces all sets of one session the person owns in one transaction. Both get a 64 KB body limit (8,192 bytes today at `signals/operations.ts:40`), with the set cap derived from it. `read_activities` returns sessions with their sets for a date range.

### One merged-workouts read

One workout can arrive twice: Oura records it, and the person logs it with sets. The rows stay separate. One shared read treats a tracker session and a manual session as one workout when their categories match and their times overlap; the logged session supplies sets, start and duration, the tracker session supplies calories, and calories are never summed. The Body card, the body fat trend and the why-lines all use it.

### Habit notes are context, not yes or no

`habit_log` holds `user_id`, `day`, `habit_key`, optional `amount` (for example drinks), optional `note`, `source` and `updated_at`, with primary key `(user_id, day, habit_key)`. Keys come from a fixed list, `evening_alcohol` and `late_caffeine` to start; a late hard workout is read from session times, not logged as a habit. A row means it happened: there is no done column and no "no" row. The research recommended explicit no rows; the operator chose notes only, so tier two compares logged days with days without a log and says so. `log_habit` upserts by the primary key; deleting the row undoes an entry. The keys are to be aligned with the separate habits research once it is readable.

### Health Connect mapping notes (no export here)

A session maps to `ExerciseSessionRecord`, with sauna and cold plunge falling back to `EXERCISE_TYPE_OTHER_WORKOUT` (0). A set maps to `ExerciseSegment`; export needs synthesized set times and an exercise-to-segment table, and RPE would be 10 minus the reps-in-reserve midpoint, an assumption. Health Connect has no habit record, so habits stay in Tare.

### Scale body fat as a weighted, slow trend

Every reading is stored and shown. The trend uses the first weigh-in of each day; a reading within 12 hours after a merged workout or sauna is shown marked "after a workout" and left out of the trend, because water shifts move it. The trend is a 28-day rolling median shown with the scale's change-tracking error of about 2 points. A change under 2 points over at least 4 weeks reads "within this scale's error of about 2 points" instead of being hidden. The reading alone cannot separate fat from muscle, and water loss from detraining reads as a fat gain, so Tare reasons across sources and states the uncertainty in one joined line: "No strength sessions in 3 weeks. Weight down 1.2 kg. Body fat reading up 1 point, within this scale's error."

### Why-lines

Two tiers, worded as co-occurrence: a line says what was logged and, where one exists, the general finding. It never says "because".

Tier one fires when a signal (burn, HRV, resting heart rate, sleep) is more than 1 standard deviation from its 28-day baseline. The baseline excludes today and needs 14 days of that signal; no line when its standard deviation is zero; for HRV the change must also be at least 10 percent. Candidates come from a fixed list, each with a fixed template:

- Burn up, with a strength or cardio session that day: "Burn 640 kcal, above your usual 430. You logged a 55-minute workout." It sits beside the "+250 from activity" line.
- HRV down or resting heart rate up, with a strength or cardio session of 30 minutes or more ending within 4 hours of sleep start: "You trained within 4 hours of bed. Late hard workouts are linked to lower HRV." The 30-minute floor stands in for "hard", since Tare has no intensity data; an assumption.
- HRV down, with evening alcohol logged: "You logged alcohol last evening. Alcohol is linked to lower HRV."
- HRV or resting heart rate changed in either direction, with sauna or cold plunge the day before: "You logged sauna yesterday. Its effect on HRV is not settled." (and the same with "cold plunge"). No sauna effect size passed the research gate and sources disagreed on direction, so the line states the logged fact and the uncertainty; the "not settled" clause answers the earlier panel concern that the line could read as a cause.

Attribution rules: "the day or night before" means sessions that ended after the previous main sleep ended and before this night's main sleep started; the main sleep is the longest sleep period of the day. An evening habit logged for day D belongs to the night that starts on D. When several candidates fire, all are shown, since picking one would itself claim a cause. General-finding sentences carry no numbers and are checked against the cited research before they ship. Lines are computed on the server and returned in `read_signals` as a `why` list per signal.

Tier two: once an item has at least 5 logged days and 5 days without a log in the last 90, each with the signal present, the line states the person's own average: "Nights after a logged sauna: HRV averaged 8% higher (8 vs 21 nights without one logged)." Counts are always shown; no significance tests. The comparison group is "without a log", never "no". A difference under about 10 percent reads "no clear difference yet". A personal pattern replaces the tier-one wording for that item when it exists.

### Gym log import

The operator's existing gym log is imported once by an agent task outside the repository: it writes one JSON file per session in the `log_activity` input shape; unknown numbers stay null with the original cell text in the set's `notes` ("about 10" stores 10 with the note); loads are true loads, with the operator's correction kept outside the repository; the operator checks the JSON before anything is posted; each session posts with `client_id` `gymlog-<date>`, so a rerun writes nothing.

## Risks / Trade-offs

- [Oura's daily activity may not update during the day] → task 1.1 probes it before the schedule change ships; without intraday updates the adjustment only lands after each ring sync.
- [Hourly calls may exceed Oura's rate limit] → task 1.1 records the limit; the existing 429 back-off reports `oura_rate_limited`.
- [The adjustment's random error] → the cap bounds one day; the weekly recompute corrects the average through the scale.
- [The rise-only alternative pushes the week above B] → the base offset, if that option is chosen.
- [The narrowed health-signals line could let other signals move the target] → the guard test.
- [Why-lines read as causes] → fixed templates, co-occurrence wording, number-free general findings, "not settled" for sauna and cold plunge, and every firing candidate shown.
- [Body fat noise read as change] → first daily reading, post-workout readings left out, median, and the error stated in words.
- [Unknown tracker kinds] → mapped to `other`, counted in telemetry, still shown.

## Migration Plan

Each schema task ships its own numbered migration. Rollback is a restore from the nightly backup. The hourly schedule ships after task 1.1 records the rate limit. The gym log import (task 2.5) runs once after 2.1 is deployed, idempotent by client id.

## Open Questions

1. OPEN: operator choice, the morning and the week's total (same time of day, as the brief recommends, or the base offset, as r3 recommends); this also settles whether the adjustment may go below zero. Needed before task 1.3.
2. The operator's yes on the approach, which MHA-244 needs before build tickets are filed.
3. Oura's rate limit, and whether its daily activity updates during the day or carries an intraday timeline (task 1.1).
