## Context

The `tare-v1` change stores daily signals and activity sessions (`packages/engine/migrations/0011_health_signals.sql`), syncs Oura once a day at 7:00 (`packages/engine/src/oura/sync.ts:159`), and keeps the calorie target on pure energy balance: mean intake of signed-off days minus the weight trend's rate times 7,700 kcal per kg, recomputed weekly (daily-target spec). Oura workouts already write their calories into `activity_sessions` (`sync.ts:118`). The Body card (`apps/web/src/health.tsx`) shows signals across sources, and its client schemas (`apps/web/src/health-api.ts`) drop unknown fields.

Governing principle from the operator: Tare uses every health source it holds and weights an imprecise one by its measured accuracy; it never discards one. Research behind the numbers here: a 12-device doubly labelled water study put free-living activity-burn error at 19 to 100 percent; Oura's own validation found it underestimates more as intensity rises; a 15-device BIA study with a four-compartment reference put body fat change-tracking error at 1.7 to 2.6 points; WHOOP's member data tied hard exercise ending within 4 hours of sleep to lower HRV and higher resting heart rate. The thresholds below (1 standard deviation, 10 percent, 2 points, 4 weeks, 14 days, the 500 kcal cap) are assumptions, not measured values, and are configuration where a person might tune them.

Single person in V1 (every row still carries `user_id`). Raw SQL with generated types. No mutation testing.

## Goals / Non-Goals

**Goals:**
- A training day raises that day's target from the tracker's own burn, without letting the tracker's steady bias move the weekly estimate.
- Sets, sessions and context notes are logged once and read the same way by every consumer.
- When a signal moves, the Body card says what was logged nearby, worded as co-occurrence.
- Body fat is shown as a trend with its error instead of being hidden.

**Non-Goals:**
- Posting from an agent workout skill: waits until Cairn hosts an embedded agent surface.
- A routine-change note, `routine_changes` table, post-change window or planned-change prompt: the operator's concern is the training day, not a long break.
- Significance tests, or any fat versus muscle call from the scale.
- Summing burn across sources.

## Decisions

### Today's target is the weekly target plus an activity adjustment

`target = stored weekly target + clamp(today_burn_so_far - usual_burn_by_now, -500, +500)`, where both burns come from the same source.

Why it works: the weekly estimate already contains the person's average activity, because it is measured from intake and weight change. Adding the full tracker burn would count activity twice and import the tracker's bias. Adding only the difference from that source's own usual burn cancels the steady part of its bias (a tracker that reads 20 percent high reads high on both sides of the subtraction). The scale then corrects what remains: if adjustments run high, weight falls slower than planned and the next weekly recompute lowers the base.

Alternatives considered: add the tracker's full burn (rejected: double counting and an error up to 100 percent), use tracker burn only as an explanation (rejected by the operator ruling that tracker burn feeds the calculation), a fixed percentage per workout kind (rejected: no source measured one).

Rules:
- No burn sample today, or a source with fewer than 14 days of samples in the last 28: no adjustment, and the card says why.
- Several sources: the adjustment uses the one source with the most sample days in the last 28 (ties by source name); sources are never summed.
- The cap of 500 kcal each way is an assumption, stated as unmeasured.
- The card shows the base and the adjustment, for example "+250 from activity".
- Slot budgets and the Home Assistant sensors keep reading the one target reader, so they follow the adjusted target; the existing rule that a change during the day moves only open slots applies.

### OPEN: operator choice, the drift rule

A naive adjustment compares today's burn so far against a full day's average, so it reads negative every morning; clipping it at zero instead makes an adjustment that only rises and skews the week upward (about 80 kcal a day in an illustrative case). Two fixes:

- **Recommended: same time of day.** `usual_burn_by_now` is the mean, over the previous 28 days with samples, of that source's cumulative burn at the same local time of day. The adjustment goes both ways and averages about zero over a typical week.
- **Alternative: base offset.** Compare against the full-day average, clip at zero, and lower each day's base by the mean adjustment of the previous 28 days.

The spec and task 1.3 are written for the recommended option. The requirement carries the marker `OPEN: operator choice` and isolates the rule in one function (`usualBurnByNow`), so the alternative swaps in without changing the reader, the card or the tests' shape.

### Intraday burn samples

Same-time-of-day comparison needs cumulative burn at known times. Each sync stores a sample (`burn_samples`: user, source, day, observed_at, cumulative active kcal), upserted by user, source and observed minute, so a retry stores nothing twice. Task 1.1 checks whether Oura's daily activity data already carries an intraday timeline; if it does, past days can be backfilled from it instead of waiting 14 days of hourly samples. Task 1.1 also records Oura's rate limit, which decides whether hourly is safe.

### Hourly Oura sync

The schedule changes from `0 7 * * *` to hourly. Each run fetches today and yesterday only after the first full backfill, which keeps the call count within the limit recorded by task 1.1. The existing upserts and the last-sync rule are unchanged.

### Sessions, sets and the kind table

`activity_sessions` gains a nullable `notes` column. Kind stays free text; a fixed kind-to-category table maps known kinds (`strength`, `run`, `cycle`, `walk`, `sauna`, `cold_plunge` and the Oura activity names) to a category (`strength`, `cardio`, `heat`, `cold`, `other`); an unknown kind is `other`. `activity_sets` has a composite foreign key to `activity_sessions (user_id, id)`, a unique `(user_id, session_id, set_index)`, exercise, reps, `load_kg`, duration seconds, a reps-in-reserve range and notes. Loads are always stored in kilograms; the unit a person typed is display only. `log_activity` accepts sets, `replace_activity_sets` swaps a session's sets in one write transaction, and both take a 64 KB body limit (today 8,192 bytes at `signals/operations.ts:40`), with the set count capped so a full payload fits. A tracker's calories never go on a logged session.

### One merged-workout read

A logged session and a tracker session of the same category whose times overlap are one workout. The logged session supplies sets, notes and times; the tracker session supplies calories; calories are never summed. One query does this merge, and every consumer reads it: the Body card list, the body fat exclusion, why-lines and tier-two counts.

### Habit notes are context, not yes or no

`habit_log` has primary key `(user_id, day, key)`, an optional amount and an optional note, and no done column. A fixed key list (starting with `alcohol`, `late_caffeine`, `late_meal`, `illness`, `travel`) lives in one vocabulary file. No row means nothing was logged, not "no". Logging the same key on the same day replaces the note. Deleting a note removes the row.

### Why-lines

Tier one compares each signal with its baseline: the 28 days before the day, excluding the day itself, shown only with at least 14 baseline days. A signal fires when it is more than 1 standard deviation from the baseline mean, and for HRV also at least 10 percent; a baseline with zero spread fires nothing. Candidates are a fixed list, each with a fixed template and a known direction:

- a workout on a day whose active burn fired high;
- a workout ending within 4 hours of the main sleep's start, beside low HRV or high resting heart rate (the main sleep is the night's longest sleep period);
- alcohol logged on the evening before, beside low HRV;
- sauna logged the day before: "You logged sauna yesterday. Its effect on HRV is not settled." with no direction.

Evening notes on day D attach to the night that starts on D. Every candidate that fires is shown. Lines never say "because", and the general-finding sentences carry no numbers until the research figures are checked against promoted research.

Tier two, per logged key or session kind, compares the next-night signal on days with a log against days with no log, once each side has 5 days in the last 90, and shows both counts: "On days you logged sauna, your HRV the next night averaged 48 ms, against 52 ms on days with no sauna logged (8 and 21 days)." No significance test.

### Body fat trend

Only the first weigh-in of a day counts, and a reading within 12 hours after the end of a merged workout or a sauna is dropped. The trend is a 28-day rolling median. A change is named only when it reaches 2 points over at least 4 weeks; the trend is always shown with its error band of about 2 points. The card never calls a change fat or muscle; the workout log and weight trend carry that story.

## Risks / Trade-offs

- [Oura's daily activity may not update during the day] → task 1.1 probes it before 1.2 and 1.3 are built; if it does not, 1.3 runs on hourly samples only after confirming they change.
- [Hourly calls may exceed Oura's rate limit] → task 1.1 records the limit; 1.2 fetches only recent days per run.
- [The adjustment's random error] → the cap bounds one day; the weekly recompute corrects the average through the scale.
- [The changed health-signals line could let other signals move the target] → a guard test asserts that signals other than the chosen source's active burn, session calories and habit notes cannot change the target.
- [Why-lines read as causes] → fixed templates, co-occurrence wording, no numbers in general findings, and a "not settled" line for sauna.
- [Body fat noise read as change] → median, filtering, a 2-point and 4-week threshold, and a visible error band.
- [Kind table drift as trackers add kinds] → unknown kinds fall to `other` and still show.

## Migration Plan

Each schema task ships its own numbered migration; none rebuilds a table except where SQLite needs it to add a CHECK, which starts with `-- tare:rebuild`. Rollback is a restore from the nightly backup. The hourly schedule ships after task 1.1 records the rate limit. The gym log import (task 2.4) runs once after 2.1 is deployed, idempotent by client id.

## Open Questions

1. OPEN: operator choice, the drift rule (same time of day, recommended, or base offset). Needed before task 1.3 is built.
2. The operator's yes on the approach, which MHA-244 needs before build tickets are filed.
3. Whether Oura's daily activity carries an intraday timeline and what its rate limit is (task 1.1).
