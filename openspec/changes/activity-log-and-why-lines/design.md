## Context

The `tare-v1` change stores daily signals and activity sessions (`packages/engine/migrations/0011_health_signals.sql`). `activity_sessions` requires `started_at` and a positive `duration_minutes`, and `log_activity` (`packages/engine/src/signals/operations.ts:82`) writes sessions as `manual` from the browser or `agent` from a service token, idempotent by an optional `client_id`. `read_signals` returns a day's raw sessions (`:150`). Oura workouts land in `activity_sessions` with Oura's calorie estimate (`packages/engine/src/oura/sync.ts:118`).

Daily burn is the `active_calories` signal, mapped from Oura's daily activity record by its `day`. `daily_signals` keeps one overwritten value per user, day, metric and source, so Tare has no intraday history. `log_signal` also writes active calories as `manual` or `agent`. The Oura sync runs once a day at 7:00 (`sync.ts:159`) and re-reads three days back through tomorrow; a 429 retries and then reports `oura_rate_limited`. Oura allows 5000 requests per 5 minutes, and its daily activity record starts at 4 AM.

The calorie target never reads signals. The adaptive estimate is mean signed-off intake minus the weight trend's energy change over 28 days (`packages/engine/src/target/adaptive.ts:115`); a weekly job stores it and reads the stored result directly (`target/recompute.ts:28`). One reader, `readTarget` (`target/reader.ts:28`), returns a strict schema with `basis` `weekly_adaptive`, `weekly_formula` or `live_formula`; `/api/today`, `readPlan` (slot budgets, `read_day_plan`, `read_plan`, `next_slot`) and `apps/web/src/today-api.ts` consume it. Slot budgets must be integers, and the last open slot takes the remainder. No Home Assistant code exists yet.

The Body card (`apps/web/src/health.tsx`) reads signals through its own query and lists sessions with duration and calories. Its client schemas (`apps/web/src/health-api.ts`) drop unknown keys and require `started_at` and `duration_minutes`, and `bodyRows` filters rows by source. The Today page fetches once with no periodic refetch, and `refreshToday` does not invalidate signals. Weigh-ins store `body_fat_pct`, but the weight history query selects weight only and the web schema drops it.

Governing principle from the operator: Tare takes in every source and weights an imprecise one by its measured accuracy, never discarding it. Hand-entered burn is weighted rather than discarded: it is shown and used in why-lines, but does not drive the target bonus. Research behind the numbers here: a 12-device doubly labelled water study put free-living activity-burn error at 19 to 100 percent; Oura's validation (n = 32) found per-person systematic bias growing with intensity; a 15-device BIA study with a four-compartment reference put body fat change-tracking error at 1.7 to 2.6 points; WHOOP member data tied late hard exercise to 14 percent lower HRV and 7 percent higher resting heart rate. Every threshold Tare itself uses (1 standard deviation, 10 percent, 2 points, 4 weeks, 14 days, 8 readings, 5 and 5, the cap, the refresh interval) is an assumption.

Single person in V1 (every row still carries `user_id`). Raw SQL with generated types, no Kysely. No mutation testing.

## Goals / Non-Goals

**Goals:**
- A training day earns extra calories from the tracker's own burn, on top of a weekly target that energy balance still sets.
- Workouts with sets, sauna, cold plunge and a few habits are kept as context notes, logged once and read the same way by every consumer.
- When a signal moves, the Body card says what was logged the day or night before, worded as co-occurrence.
- Scale body fat is used and shown with its error.

**Non-Goals:**
- The /workout skill writing to Tare: deferred until Cairn hosts an embedded agent surface in apps.
- The routine-change note, post-change window, `routine_changes` table and planned-change prompt: the daily bonus answers the training-day concern.
- Oura's per-minute MET series as an intraday source, excluding low-wear days from the average, and detecting a lapse in intraday updates: revisit if the probe or real data calls for them.
- Health Connect import and export (mapping notes below only), significance tests, and any multi-user feature.

## Decisions

### The day's target is B plus a rise-only bonus

The weekly target B still comes from energy balance, unchanged, and the weekly recompute keeps reading the stored result, so the bonus never feeds back into B. The day's base is B. The day's target is B plus an activity bonus: the selected tracker's active burn minus that tracker's own 28-day average, never below zero, capped. Example: usual Oura burn 430 kcal, today 680 kcal; the bonus is +250 and the card shows "Base 2,180. +250 from activity." A quiet day gets B, not less. The operator ruled out an offset.

Why a relative delta cancels a tracker's consistent bias: the large error in the research applies to absolute values; the delta compares a tracker with itself. A fixed offset cancels completely. A proportional bias shrinks to the size of the departure (a ring reading 20 percent low turns a true +300 day into +240, an error of 60 kcal). Intensity-dependent error under-credits hard days, which errs toward less food. Random day-to-day error does not cancel, which is why there is a cap and why the weekly total is never set by the tracker. This holds only because one tracker is compared with itself; hand-entered burn has no such consistency, which is one reason it does not drive the bonus. This is the research's rejected option 2; the operator chose it with the error stated.

Alternatives considered: tracker burn as explanation only (replaced by the operator's ruling that fitness data feeds the calculation), adding the full tracker burn (double counting), a fixed percentage per workout kind (no source measured one), a base offset or a two-way same-time-of-day comparison (both declined by the operator).

### The week runs above B, by choice

A bonus that can only rise adds calories on active days and removes none on quiet days. Illustration, not measured: if daily burn varies by about 200 kcal, the bonus averages about 80 kcal a day, about a sixth of a 500 kcal deficit. The operator accepted this; the card shows the base and the bonus separately so the extra is always visible.

Nothing corrects the extra automatically. It is real eating above B, not an error in the estimate: the estimate is mean intake minus the trend's energy change, so 80 kcal more food and 80 kcal less loss cancel. At a true expenditure of 2,680 kcal, eating 2,180 with a 500 kcal deficit and eating 2,260 with a 420 kcal deficit give the same estimate, so B is 2,180 either way. The drift lasts as long as the bonuses do, and the spec says so rather than claiming the week averages to B. A lasting change in routine is still counted once: a real rise in activity raises the measured expenditure, later recomputes move it into B, and the 28-day average rises with it so the same burn stops counting as extra.

While B is a formula target, the bonus applies the same way: the formula's activity factor stands for the usual level and the bonus is the departure from the person's own average (an assumption). The card shows which base is in force. The weekly target notice keeps comparing B.

### Which burn counts

Only a tracker source drives the bonus: a fixed engine-side list of eligible sources, `oura` today, extended when a watch is added. Burn logged by hand (`manual` or `agent`, written by `log_signal`) is shown and used in why-lines but never drives it. This list is separate from the web display order, which stays as it is. With more than one eligible tracker, one is selected per person in a fixed order, and the day's value and the 28-day average both come from it; trackers are never summed. The reader returns the selected source and the card names it.

### The 28-day average

The mean of the selected source's `active_calories` over the 28 days before the credited day, not including it. A day counts if the source has a reading for it; days without one are left out, not counted as zero. Tare does not read non-wear time, so a low-wear day with a reading counts (an assumption). The bonus needs at least 14 days with a reading in those 28. Values are read when the target is read; the sync re-reads three days back, so a corrected reading changes the average from the next read, and nothing is frozen.

### Same-day or next-day credit, set by the probe

Task 1.1 probes whether Oura's daily activity record for today updates during the day and how often the ring syncs to Oura's cloud, keeps the result as evidence, and sets the credit mode, which is configuration.

- **Same day (probe positive):** the sync moves from `0 7 * * *` to `0 * * * *`, the calendar refresh's precedent, and today's bonus is `max(0, today so far minus the average)`, capped. Burn accrues through the day, so on a morning workout day the bonus appears once the day's burn passes the full-day average, usually by midday, and lands in the slots that have not ended.
- **Next day (probe negative):** once yesterday's full burn has synced, its extra over the 28-day average (the 28 days before yesterday) goes onto today's target, rise-only and capped. The existing 7:00 sync already delivers yesterday, so the schedule stays. The card says "+250 from yesterday's activity."

A positive probe that later stops holding is not detected automatically in V1. Oura's limit is far above 24 hourly runs a day; the task runs one real hourly sync and keeps the output as evidence.

### Day boundary and stale readings

Oura's daily record starts at 4 AM; Tare's day starts at the person's own day-start hour. The bonus for Tare day D reads the Oura record whose `day` is D, as the sync already stores it, and the hours between the two boundaries belong to Oura's day. This is accepted and stated rather than corrected. `updated_at` changes on every fetch, so it does not prove a fresh ring reading; the bonus does not need that proof, because it is rise-only and a stale low value can only under-credit. The card shows the burn value and the last sync time.

### Cases

- Awaiting data (an eligible source, but no reading for the credited day yet): the target is B; the card says "Activity: waiting for today's data."
- No usable source (no eligible tracker, or under 14 days with a reading): the target is B; the card says "Activity bonus after 14 days of tracker data."
- The cap is unmeasured: configuration with an assumed default of 500 kcal. A capped day shows "+500 from activity (capped)".
- Whole calories: the reader rounds the bonus after the cap to whole kcal before adding it, once, so base plus bonus is an integer and slot budgets stay integers. The build lane picks the step (1 or 10 kcal).
- The reader's result gains the base, the bonus (status, kcal, source, mode, capped) and the total; `kcal` stays the total, so `/api/today` remaining kcal and every plan read pick the bonus up with no second calculation. Ended slots keep their budgets. The web schema and target card are updated in the same task.
- A guard test proves HRV, sleep, sessions, session calories, habit notes, and `manual` or `agent` active calories written through `log_signal` never change the target, and that tracker active calories change it only through the capped, rise-only bonus.

### Keeping an open page current

An Oura sync writes on the server with no browser action, so an open page would otherwise show a new target beside old burn, workouts and why-lines. The task that ships the bonus refetches the today, plan and signals queries (and the activities query, if separate) together, on window focus and every 15 minutes (an assumption), keeping every existing refetch path. Logging writes refresh the same set by extending `refreshToday`. A test changes the stored Oura data with no browser write or focus event and checks that the target and the Body card both update at the next interval.

### Sessions, timing, sets and categories

`activity_sessions` gains nullable `notes` and `timing` (`exact` by default, or `date_only`). An exact session keeps a required start and a positive duration. A date-only session has a day and sets but no time: `started_at` and `duration_minutes` are NULL, tied to `timing` by a CHECK. Both columns are NOT NULL today, so the migration rebuilds the table (new table, copy, rename; `-- tare:rebuild` on the first line), keeping every key and constraint. No placeholder time is ever stored. Every reader handles NULL: the activities query orders date-only sessions after timed ones by `id`, the web schema makes both fields nullable, and the Body card shows "time not recorded". Tracker sessions are always exact.

Date-only sessions are left out of every rule that needs a time: workout pairing, sleep attribution, the late-workout line and the 12-hour body fat exclusion. They still count where only the day matters: the day's activity list, "No strength sessions logged in 3 weeks", and logged-day counts in tier two.

Sauna and cold plunge are sessions, with kinds `sauna` and `cold_plunge`. A fixed category list maps each kind to `strength`, `cardio`, `sauna`, `cold_plunge` or `other`; Oura's activity strings map through a fixed table, and an unknown string maps to `other`, shows as an unpaired row and is counted in telemetry, never dropped. Session calories stay the tracker's estimate for that workout, shown on the row and never added to burn, intake or the target.

`activity_sets` holds one row per set: `user_id`, `session_id` (composite reference to `activity_sessions (user_id, id)`), `set_index` (1 and up), `exercise` (nonblank), `set_type` (`warmup`, `working`, `drop`, `failure`; default `working`), nullable `reps`, `load_kg` (0 or more, always kilograms; pounds converted before storing), `load_unit` (`kg` or `lb`, display only), nullable `duration_seconds`, `rir_low` and `rir_high` (0 to 10, low at most high), nullable `notes`, and `UNIQUE (user_id, session_id, set_index)`.

### Operations and limits

All operations are `browser_and_agent` in the existing registry, so each is an HTTP route and an MCP tool with the existing person guard. The MCP route caps a whole request at 65,536 bytes, so `log_activity` and `replace_activity_sets` get a 60,000-byte operation limit, leaving headroom for the tool-call envelope; the set cap is derived from it, and a test posts the largest allowed session over both HTTP and MCP.

- `log_activity` takes optional `notes`, `sets` and `timing`. Exact requires `started_at` and a positive `duration_minutes` as today; date-only takes a `day` and refuses both. Session and sets are written in one transaction; a replay with the same `client_id` returns the stored session and writes nothing. New logging controls always send a `client_id` and reuse it across retries.
- `replace_activity_sets` is a full replacement in one transaction: an identical retry leaves the same set list, and an empty list removes all sets.
- `read_activities` returns merged workouts with their sets for a date range.
- `log_habit` upserts by `(user_id, day, habit_key)`; `delete_habit` removes the row, which is how an entry is undone.

Composite keys enforce ownership. Operation-level tests show that `log_activity` sets, `replace_activity_sets` (an empty replacement included) and `read_activities` on another person's session fail and change no rows.

### One merged-workouts read

One workout can arrive twice: Oura records it, and the person or an agent logs it with sets. The rows stay separate and one read pairs them; the Body card, the body fat trend and the why-lines all use it.

- A pair is one tracker session (any source other than `manual` and `agent`) and one exact logged session (`manual` or `agent`) with the same category whose time ranges overlap. A date-only session is never paired.
- Matching is one-to-one and deterministic: for each logged session in start order, take the unpaired overlapping tracker session with the largest overlap; ties go to the earlier tracker start, then the lower id.
- In a pair, the logged session supplies sets, notes, start and duration; the tracker session supplies calories, never summed. Unpaired sessions are shown as they are.
- `read_signals` returns merged workouts in place of today's raw sessions, so the Body card shows each workout once. A raw-session read may stay only as an explicit, separately named operation.

### Habit notes are context, not yes or no

`habit_log` holds `user_id`, `day`, `habit_key`, optional `amount`, optional `note`, `source` and `updated_at`, primary key `(user_id, day, habit_key)`. Keys come from a fixed list, `evening_alcohol` and `late_caffeine` to start, to be aligned with the separate habits research once it is readable. A late hard workout is read from session times. A row means it happened; there is no done column and no "no" row, and a mistaken entry is deleted, leaving the day not logged.

### Health Connect mapping notes (no export here)

A session maps to `ExerciseSessionRecord`, with sauna and cold plunge falling back to `EXERCISE_TYPE_OTHER_WORKOUT` (0). A set maps to `ExerciseSegment`; export needs synthesized set times and an exercise-to-segment table, and RPE would be 10 minus the reps-in-reserve midpoint, an assumption. Health Connect has no habit record.

### Scale body fat as a weighted, slow measure

Every reading is stored and shown. The trend uses the first weigh-in of each day; a reading within 12 hours after a timed workout or sauna from the merged read is shown marked "after a workout" and left out of the trend. A date-only session never excludes a reading. The current level is the median of the trend readings in the last 28 days; the trend is the change between that level and the median of the 28 days before it. Each window needs at least 8 trend readings, or Tare shows the readings and says "not enough readings for a trend". A change under 2 points reads "within this scale's error of about 2 points". The reading alone cannot separate fat from muscle, so Tare states it beside the training log and weight trend: "No strength sessions logged in 3 weeks. Weight down 1.2 kg. Body fat reading up 1 point, within this scale's error." A body fat history read and its client schema are added, since today's read selects weight only.

### Why-lines

Two tiers, worded as co-occurrence; a line never says "because".

Tier one fires when burn, HRV, resting heart rate or sleep is more than 1 standard deviation from its 28-day baseline. The baseline excludes the day and needs 14 days of that signal; no line when its standard deviation is zero; HRV also needs a 10 percent change. Burn lines use every burn source, hand-entered included, each labelled with its source; the web `bodyRows` filter changes so burn lines draw from every source row. Date-only sessions count only in rules keyed to the day. Candidates and templates are fixed:

- Burn up, with a strength or cardio session that day: "Burn 640 kcal, above your usual 430. You logged a 55-minute workout."
- HRV down or resting heart rate up, with a strength or cardio session of 30 minutes or more ending within 4 hours of sleep start: "You trained within 4 hours of bed. Late hard workouts are linked to lower HRV." The 30-minute floor stands in for "hard"; an assumption.
- HRV down, with evening alcohol logged: "You logged alcohol last evening. Alcohol is linked to lower HRV."
- HRV or resting heart rate changed in either direction, with sauna or cold plunge the day before: "You logged sauna yesterday. Its effect on HRV is not settled." No sauna effect size passed the research gate and sources disagreed on direction, so the line states the fact and the uncertainty.

Attribution: "the day or night before" means sessions that ended after the previous main sleep ended and before this night's main sleep started; the main sleep is the day's longest sleep period. An evening habit logged for day D belongs to the night that starts on D. Every firing candidate is shown. General-finding sentences carry no numbers and are checked against the cited research before they ship. Lines are computed on the server and returned in `read_signals` as a `why` list per signal.

Tier two: once an item has at least 5 logged days and 5 days without a log in the last 90, each with the signal present: "Nights after a logged sauna: HRV averaged 8% higher than nights without one logged (8 vs 21 nights). Small sample; days you log may differ from days you don't in other ways." Counts and the caveat are always shown; no significance tests. The comparison is between logged days and days without a log, never "did" against "did not"; which days get logged is not random, so the line describes an association with unknown logging bias. A difference under about 10 percent reads "no clear difference yet". A personal pattern replaces the tier-one wording for that item.

### Gym log import

An agent task outside the repository imports the operator's existing gym log. Every session goes in as a date-only record with its sets, since the log gives dates and sets but no times; an entry that records no session is skipped. Unknown numbers stay null with the original cell text in the set's notes; loads are true loads, with the operator's correction kept outside the repository. The operator checks the JSON before anything is posted; each session posts with `client_id` `gymlog-<date>`, and the agent stops and asks if it finds a second session on any date.

## Risks / Trade-offs

- [The week runs above B by the bonuses, with no automatic correction] → accepted by the operator; the card shows base and bonus separately.
- [Oura's daily activity may not update during the day] → the probe sets next-day credit instead.
- [A positive probe stops holding later] → not detected in V1; the mode is configuration and can be switched.
- [The bonus's random error] → the cap bounds one day.
- [The 4 AM boundary differs from the person's day start] → accepted and stated in the spec.
- [The narrowed health-signals line could let other signals move the target] → the guard test.
- [A table rebuild on populated data] → `-- tare:rebuild`, a populated-upgrade test, and the nightly backup.
- [Why-lines or tier two read as causes] → fixed templates, co-occurrence wording, the small-sample caveat and number-free general findings.
- [The body fat exclusion removes many readings] → the 8-reading minimum and the count shown.

## Migration Plan

Each schema task ships its own numbered migration; the session table rebuild starts with `-- tare:rebuild`. Rollback is a restore from the nightly backup. The schedule change ships only with a positive probe. The gym log import runs once after task 2.1 is deployed, idempotent by client id.

## Open Questions

1. The operator's yes on the approach, which MHA-244 needs before build tickets are filed.

Decided on Nov 8: rise-only bonus on B with no offset; next-day credit if Oura does not update during the day; hand-entered burn shown and used in why-lines but never driving the bonus; the gym log as date-only sessions with their sets, left out of every timing rule.
