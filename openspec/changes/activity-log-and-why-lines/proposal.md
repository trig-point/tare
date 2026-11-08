## Why

Tare already stores tracker burn, workouts and recovery signals, but it uses none of them: the target ignores a hard training day, nothing records sets, a sauna or a drink, and when HRV drops the app shows the number with no context. Tare is meant to be the person's health hub, so every source it holds should feed what it shows, weighted by how accurate that source is measured to be, instead of being left out.

## What Changes

- Today's calorie target becomes the weekly energy-balance target plus an activity adjustment: today's tracker burn so far minus the person's usual burn from the same source by the same time of day, capped at 500 kcal. The weekly estimate itself is unchanged. The drift rule is an open operator choice (see design).
- The Oura sync runs hourly instead of once a day, so today's burn is current.
- Activity sessions gain notes, sets (reps, load in kilograms, effort) and two new kinds, sauna and cold plunge. One merged-workout read joins a logged session with the tracker workout it overlaps, so no consumer counts one workout twice.
- A habit log records context notes for a day (for example alcohol or illness). A note has no yes or no value: no row means nothing was logged.
- The Body card lists the day's merged workouts with their sets, sessions and habit notes, and lets the person log them.
- Tier-one why-lines: when a signal is more than one standard deviation from its 28-day baseline, the Body card names the logged items from a fixed list that co-occurred, worded as co-occurrence, never as cause.
- Body fat from the scale is shown as a filtered 28-day median trend with its measured error of about 2 points, never as fat versus muscle.
- Tier-two patterns compare a signal on days with a logged item against days with no log of it, once each side has 5 days.
- The operator's existing gym log is imported once through the new operations.
- **BREAKING** (spec): the health-signals line "Signals SHALL NOT change the calorie target in version 1" is narrowed: tracker burn changes today's target only through the activity adjustment.

Not in this change: posting from an agent workout skill (waits for an embedded agent surface), a routine-change note or post-change window, and a planned-change prompt before trips.

## Capabilities

### New Capabilities
- `activity-log`: sessions with notes and sets, sauna and cold plunge kinds, the kind-to-category table, the merged-workout read, habit notes, their operations and the Body card logging.
- `signal-explanations`: tier-one why-lines, tier-two patterns and the body fat trend.

### Modified Capabilities
- `health-signals`: the daily signals store may change today's target through the activity adjustment; the Oura sync runs hourly.
- `daily-target`: today's target adds the activity adjustment to the stored weekly target.

## Impact

- Engine: new migrations for session notes and kinds, `activity_sets`, `habit_log` and intraday burn samples; new queries in `.sql` files with TypeSQL types; the target reader (`packages/engine/src/target/reader.ts`); the signals operations and their body limit (`packages/engine/src/signals/operations.ts`); the Oura sync schedule (`packages/engine/src/oura/sync.ts`).
- Web: `apps/web/src/health-api.ts` schemas (unknown fields are dropped today, so every new field is added there) and the Body card in `apps/web/src/health.tsx`.
- No new package. Depends on the `tare-v1` change's signals store (6.1), Oura sync (6.3), weekly recompute (5.2), weight trend (3.2), slot budgets (8.3) and Body card (6.4); this change's delta specs apply after `tare-v1` is archived.
