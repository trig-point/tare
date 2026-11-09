## Why

Tare already stores tracker burn, workouts and recovery signals, but it uses none of them: the target ignores a hard training day, nothing records sets, a sauna or a drink, and when HRV drops the app shows the number with no context. Tare is meant to be the person's health hub, so every source it holds should feed what it shows, weighted by how accurate that source is measured to be, instead of being left out.

## What Changes

- The day's calorie target becomes the weekly energy-balance target B plus a rise-only activity bonus: one eligible tracker's burn above its own 28-day average, capped at 500 kcal and rounded to whole kcal. The card shows both, for example "Base 2,180. +250 from activity." The weekly estimate is unchanged. The bonus is credited the same day if the tracker's daily record updates during the day, otherwise the next day. The week runs above B on average by the bonuses, which the operator accepted.
- Burn entered by hand (manual or agent) is shown and used in why-lines but never drives the bonus.
- The Oura sync runs hourly when same-day credit is in force; an open Today page refetches the target, plan and signals on focus and every 15 minutes.
- Activity sessions gain notes, a timing of exact or date-only (a date-only session stores no time), sets (set type, reps, load in kilograms, reps in reserve) and two new kinds, sauna and cold plunge. One merged-workouts read pairs a logged session with the tracker workout it overlaps, one-to-one, and replaces the raw session list in `read_signals`.
- A habit log records context notes for a day (evening alcohol and late caffeine to start). A row means it happened; a day without one is not logged, never "no".
- The Body card shows each workout once with its sets, plus sessions and habit notes, with quick logging and a workout with sets entered by hand.
- Tier-one why-lines: when burn, HRV, resting heart rate or sleep is more than one standard deviation from its 28-day baseline, the Body card names the logged items from a fixed list that co-occurred, in fixed templates, never as a cause.
- Every scale body fat reading is shown; the trend compares the 28-day median level with the 28 days before, with post-workout readings marked and left out, stated with the scale's error of about 2 points.
- Tier-two patterns compare nights after logged days with nights after days without a log, with counts and a small-sample caveat.
- The operator's existing gym log is imported once as date-only sessions, by an agent task outside the repository.
- **BREAKING** (spec): the health-signals line "Signals SHALL NOT change the calorie target in version 1" is narrowed: active calories from one eligible tracker raise the day's target only through the bonus.

Not in this change: posting from an agent workout skill (waits for an embedded agent surface), the routine-change note, post-change window and planned-change prompt, Oura's per-minute series, Health Connect import and export, and significance tests.

## Capabilities

### New Capabilities
- `activity-log`: sessions with timing, notes and sets, sauna and cold plunge kinds, the kind-to-category list, the merged-workouts read, habit notes, their operations and the Body card logging.
- `signal-explanations`: tier-one why-lines, tier-two patterns and the body fat trend.

### Modified Capabilities
- `health-signals`: active calories from one eligible tracker may raise the day's target through the bonus; the Oura sync runs hourly in same-day mode.
- `daily-target`: the one target reader returns the base, the bonus and the total.

## Impact

- Engine: new migrations for session notes and timing (a rebuild of `activity_sessions`), `activity_sets` and `habit_log`; new queries in `.sql` files with TypeSQL types; the target reader (`packages/engine/src/target/reader.ts`); the signals operations and their body limit (`packages/engine/src/signals/operations.ts`); the Oura sync schedule (`packages/engine/src/oura/sync.ts`); a body fat history read.
- Web: `apps/web/src/today-api.ts` and `apps/web/src/health-api.ts` schemas (unknown fields are dropped today), the target card, the Body card (`apps/web/src/health.tsx`), the `bodyRows` source filter, and refetch on focus and interval.
- No new package. Depends on the `tare-v1` change's signals store (6.1), Oura sync (6.3), weekly recompute (5.2), weight trend (3.2), slot budgets (8.3) and Body card (6.4); this change's delta specs apply after `tare-v1` is archived.
