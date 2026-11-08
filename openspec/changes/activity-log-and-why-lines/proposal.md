## Why

Tare already stores tracker burn, workouts and recovery signals, but it uses none of them: the target ignores a hard training day, nothing records sets, a sauna or a drink, and when HRV drops the app shows the number with no context. Tare is meant to be the person's health hub, so every source it holds should feed what it shows, weighted by how accurate that source is measured to be, instead of being left out.

## What Changes

- The day's calorie target becomes a base plus an activity adjustment: today's tracker active burn compared with the person's usual burn from the same source, capped at 500 kcal, for example "+250 from activity". The weekly energy-balance estimate is unchanged and the day's targets still average to it. How the morning is handled (same time of day, or a rise-only adjustment with a base offset) is an open operator choice (see design).
- The Oura sync runs about hourly instead of once a day, so today's burn is current.
- Activity sessions gain notes, sets (set type, reps, load in kilograms, reps in reserve) and two new kinds, sauna and cold plunge. One merged-workouts read joins a logged session with the tracker workout it overlaps, so no consumer counts one workout twice.
- A habit log records context notes for a day (evening alcohol and late caffeine to start). A row means it happened; a day without one is not logged, never "no".
- The Body card shows the day's merged workouts with their sets, sessions and habit notes, with quick logging for sauna, cold plunge and habits and a workout with sets entered by hand.
- Tier-one why-lines: when burn, HRV, resting heart rate or sleep is more than one standard deviation from its 28-day baseline, the Body card names the logged items from a fixed list that co-occurred, in fixed templates, never as a cause.
- Every scale body fat reading is shown; the trend is a 28-day median of first daily readings, with post-workout readings marked and left out, stated with the scale's error of about 2 points and read beside the training log and weight trend.
- Tier-two patterns compare the night after a logged item with nights after days without a log, once each side has 5 days in the last 90.
- The operator's existing gym log is imported once through the new operations, by an agent task outside the repository.
- **BREAKING** (spec): the health-signals line "Signals SHALL NOT change the calorie target in version 1" is narrowed: active calories from one tracker source change the day's target only through the activity adjustment.

Not in this change: posting from an agent workout skill (waits for an embedded agent surface), the routine-change note, post-change window and planned-change prompt, Health Connect import and export, and significance tests.

## Capabilities

### New Capabilities
- `activity-log`: sessions with notes and sets, sauna and cold plunge kinds, the kind-to-category list, the merged-workouts read, habit notes, their operations and the Body card logging.
- `signal-explanations`: tier-one why-lines, tier-two patterns and the body fat trend.

### Modified Capabilities
- `health-signals`: active calories from one source may change the day's target through the activity adjustment; the Oura sync runs hourly.
- `daily-target`: the one target reader returns the day's base and activity adjustment.

## Impact

- Engine: new migrations for session notes, `activity_sets`, `habit_log` and, under the recommended drift rule, intraday burn samples; new queries in `.sql` files with TypeSQL types; the target reader (`packages/engine/src/target/reader.ts`); the signals operations and their body limit (`packages/engine/src/signals/operations.ts`); the Oura sync schedule (`packages/engine/src/oura/sync.ts`).
- Web: `apps/web/src/health-api.ts` schemas (unknown fields are dropped today, so every new field is added there) and the Body card in `apps/web/src/health.tsx`.
- No new package. Depends on the `tare-v1` change's signals store (6.1), Oura sync (6.3), weekly recompute (5.2), weight trend (3.2), slot budgets (8.3) and Body card (6.4); this change's delta specs apply after `tare-v1` is archived.
