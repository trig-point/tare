# One-time import

Use Node 22.18 or later and pnpm 11.2.2. Create the person in Tare first. Set `DATABASE_URL` or use the optional root `.env`, as with engine startup. From the repository root:

```sh
pnpm --filter @tare/engine run import --user example --intake /data/intake.jsonl --weight /data/weight.jsonl --days /data/days.jsonl
```

Supply at least one file. Relative file paths and `DATABASE_URL` resolve from `packages/engine`. Each UTF-8 line is one JSON object; empty lines and unknown fields are rejected. All examples below are made up.

Intake requires `client_id` (1 to 200 characters), `eaten_at`, `name`, at least one nutrient and `provenance` (`estimated` or `label`). A label requires a nonblank `source`. Nutrients are nonnegative numbers or null: `kcal`, `protein_g`, `carbs_g`, `fat_g`, `fiber_g`, `kcal_low`, `kcal_high`. Omitted nutrients stay unknown. Calorie bounds must be supplied together and contain `kcal` when it is known.

```json
{"client_id":"example-soup-1","eaten_at":"2025-06-01T12:00:00Z","name":"Example soup","kcal":240,"provenance":"estimated"}
```

Weight requires `client_id`, `measured_at`, positive `weight_kg` and nonblank `source`. Optional `body_fat_pct` is null or a number from 0 to 100. The source is preserved.

```json
{"client_id":"example-scale-1","measured_at":"2025-06-01T12:00:00Z","weight_kg":75,"source":"Example scale"}
```

Timestamps must include a timezone and fall between 1970-01-01T00:00:00Z and the current time plus one day. Intake and weight days use the person's timezone and day-start hour.

Days require `day` (a valid `YYYY-MM-DD` date). Optional `hunger` and `fullness` are integers from 1 to 5; optional `notes` is a nonblank string of at most 2000 characters, stored trimmed. Null fields are not accepted.

```json
{"day":"2025-06-01","hunger":3,"fullness":4,"notes":"Example day note"}
```

Keep each intake and weight `client_id` stable: reruns keep the original row for that person, even if the input changes. Days fill only empty fields. An equal value is a replay; a different existing value skips the whole line as `conflict`. Applied intake and days changes clear sign-off; replays preserve later sign-off. Weights create no days row.

Each line has its own transaction. A rejected line does not stop later lines. Each file reports `applied`, `replayed`, `skipped` and errors containing only `line` (starting at 1) and `code`. Exit codes: 0 for no skipped lines, 1 for skipped lines, 2 for usage, input-file failure or `unknown_person`. The command never creates a person. Files processed before an input-file failure remain imported; rerun after fixing the file.
