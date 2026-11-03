# Tare

This repository is public. Never add personal data, including real weight, food or health data. Fixtures use made-up people. Never commit secrets; supply them through environment variables.

Personal names and hosts are checked by gitleaks on pushes and same-repo PRs with a custom rule kept in the `TARE_GITLEAKS_TOML` secret. Fork PRs and Dependabot runs use default rules only; main re-checks after merge. To locate a finding locally, run `gitleaks git . --config <path-to-config> --redact -v`. Without the config, run `gitleaks git . --redact -v` for default rules only.

Use TypeScript only. Tests run with `node --test`.

## Layout

- `packages/engine`: Node + Hono backend.
- `packages/nutrition`: nutrition record, unit conversion and storage mapping; pure functions, never opens the database.
- `packages/engine/src/db.ts`: the only module that opens the SQLite driver; it also runs migrations.
- `packages/engine/migrations`: schema in numbered `.sql` migrations.
  Start table rebuild migrations with `-- tare:rebuild` on the first line to disable foreign keys before the transaction and check them before commit.
- `packages/engine/src/queries`: queries in `.sql` files with TypeSQL-generated types.
- `apps/*`: application workspaces.
- `apps/web`: React app shell, built by Vite and served by the engine.

SQLite only. No ORM. Kysely (a query builder) is allowed only for a query built at runtime from many optional filters. Parameters only: never insert values into SQL strings. Every query is exercised by a test against a real migrated SQLite database. Commit generated query files and regenerate them after changing SQL or migrations.

## Commands

Use Node 22 (at least 22.18) and pnpm 11.2.2. Run these from the repository root:

- Install: `pnpm install`
- Build web assets and typecheck the engine: `pnpm build`
- Lint and format check: `pnpm lint`
- Apply formatting: `pnpm format`
- Typecheck all workspaces: `pnpm typecheck`
- Test all workspaces: `pnpm test` (runs `node --test`)
- Regenerate query types: `pnpm generate`
- Run engine: optionally copy `.env.example` to `.env`, or set environment variables, then `pnpm --filter @tare/engine start`
- Health check: `curl -s localhost:3000/health`
- Container deployment: see [docs/deploy.md](docs/deploy.md).
- Weekly API drift check: `node packages/engine/scripts/api-drift-check.mts`; update `packages/engine/scripts/api-drift-baselines.json` in a reviewed PR after checking vendor changes.

Biome handles linting and formatting for the workspace. TypeScript runs in strict mode. Node strips TypeScript types directly, so the engine has no build step or type-stripping flag. Only `apps/web` is built with Vite.

## Configuration

`DATABASE_URL` is required and is a SQLite file path, or `:memory:` for an ephemeral database. Surrounding whitespace is trimmed. Relative paths resolve from the engine process working directory (`packages/engine` when using the workspace command). Parent directories are created automatically. Startup applies migrations before listening. File databases use WAL; every connection sets a 5000 ms busy timeout.

`PORT` defaults to `3000` and must be an integer from 1 to 65535. `.env.example` lists the configuration variables with safe local values. The startup command loads the root `.env` file if it exists; process environment variables can override it. Set the required variables in the process environment when running without a file.

TypeSQL generation uses an ignored local database at `packages/engine/data/typesql.sqlite`. Biome formats generated code and permits the generator's explicit `any` type in query output.

`TARE_TIMEZONE` sets the install's IANA timezone for scheduled jobs (default: `UTC`) independently of the process `TZ`. Invalid or empty values prevent startup.

`TARE_TARGET_WEEKDAY` sets the weekly target recompute day at 3:00 AM in `TARE_TIMEZONE` (default: `monday`). It accepts the seven English weekday names, trimmed and case-insensitive. Empty counts as unset; invalid values prevent startup.

Adaptive TDEE settings treat empty values as unset:

- `TARE_TDEE_WINDOW_DAYS`: window length, default 28, integer from 14 to 90.
- `TARE_TDEE_ENERGY_DENSITY`: kcal per kg, default 7700, from 5000 to 10000.
- `TARE_TDEE_MIN_SIGNED_DAYS`: minimum signed days, default 14.
- `TARE_TDEE_MIN_WEIGH_IN_DAYS`: minimum weigh-in days, default 8.
- `TARE_TDEE_MIN_SPAN_DAYS`: minimum elapsed days, default 14.
- `TARE_TDEE_DEFAULT_RANGE`: estimated intake range, default 0.25, from 0 to 0.9.

Each minimum must be an integer from 1 to the configured window length. Invalid settings prevent startup and name the variable.

`TARE_PUBLIC_URL` accepts an HTTP or HTTPS URL. An HTTPS install must set it to enable the `Secure` flag on session cookies. Empty or unset leaves `Secure` off.

`TARE_SESSION_DAYS` sets the absolute session lifetime in days (default: `30`, integer from 1 to 365). Empty counts as unset.

`TARE_BACKUP_DIR` enables daily backups at 3:00 AM in `TARE_TIMEZONE`. Empty or unset disables backups. Relative paths resolve from the engine process working directory. The backup folder must be outside the database folder; startup rejects the database folder itself and its subfolders. Use separate storage to protect against loss of the data volume.

`TARE_BACKUP_KEEP` sets the number of backup copies to keep (default: `7`, integer from 1 to 365). Surrounding whitespace is trimmed; empty counts as unset. Copies use `tare-<compact UTC timestamp>.sqlite`; retention leaves other files alone.

`TARE_ACCESS_TEAM_DOMAIN` is the Cloudflare Access HTTPS origin, with no path or trailing slash. Set it with `TARE_ACCESS_AUD` to use Access; leave both unset for password login. Switching a populated install between modes is unsupported.

`TARE_ACCESS_AUD` is the Access application's audience tag. Setting only one Access option prevents startup.

`TARE_MCP_ALLOWED_ORIGINS` is a comma-separated list of HTTP or HTTPS origins with no path. Entries are trimmed, and invalid entries prevent startup. If empty or unset, it allows only MCP requests without an `Origin` header.

`TARE_ADMIN_ACCESS_EMAIL` creates the first administrator in Access mode with `TARE_ADMIN_USERNAME`. Emails are trimmed and lowercased. Access mode uses no administrator password; fallback mode requires `TARE_ADMIN_PASSWORD`.

`TARE_USDA_API_KEY` enables USDA FoodData Central lookups; it is trimmed, and empty or unset skips USDA.

`TARE_ORDER_MODEL_BASE_URL`, `TARE_ORDER_MODEL` and `TARE_ORDER_MODEL_API_KEY` configure order-email parsing through an OpenAI-compatible model. Set all three or leave all three unset. Values are trimmed; empty values count as unset. The base URL must use HTTP or HTTPS and may include a path, but not credentials, a query or a fragment. A keyless local endpoint requires a placeholder API key. With no model configured, the parser returns `no_model` for the engine to turn into a question.

`TARE_OFF_USER_AGENT` must follow `AppName/Version (ContactEmail)`; leaving it empty or unset disables Open Food Facts requests.

Product data from [Open Food Facts](https://world.openfoodfacts.org/) is licensed under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/). Attribute Open Food Facts when using its data; ODbL share-alike terms apply to derived databases.

`TARE_ADMIN_USERNAME` and the mode's administrator credential create the first administrator in the install timezone. The system reads them only while the database has no users, and you can remove them after the first start. The username is trimmed; the password is kept exactly as set.

Keep comments short and focused on why. Use descriptive identifiers, never single-letter names. Keep personal data and secrets out of logs as well as source and fixtures.

## Known TypeSQL gaps

TypeSQL CLI 0.24.0 generates these queries without error but loses result types:

- LEFT JOIN: generated `LeftJoinResult.name` is `string`; an unmatched row returns `null`. Use the `left-join.mts` wrapper with `string | null`.
- `json_extract`: generated `JsonResult.name` is `any | null`; callers lose type checking. Use the `json.mts` wrapper with `unknown` and narrow the result before using it.
- Composite primary key insert: generated `InsertDayParams.user_id` permits `null` although `days.user_id` is NOT NULL. Callers must pass a number. The schema test uses a non-null owner type and verifies that SQLite rejects NULL.
- CHECK-constrained text: generated job status fields widen to `string` with the core schema present. Keep generated output unchanged and narrow statuses at the call site when a union is needed.

Both wrappers and their SQL files live in `packages/engine/test/compat/`, outside the generated set. Other compatibility shapes use generated functions. For future queries built at runtime from many optional filters, Kysely is allowed, as stated above.

`src/queries/compat/` and the compat fixture are test-only, never import them from engine code, and generation also loads `test/fixtures/typesql-compat.sql`, a test-only schema that is not a migration.

SQLite RETURNING row order is unspecified; callers sort the returned rows if they need an order.
