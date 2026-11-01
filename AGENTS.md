# Tare

This repository is public. Never add personal data, including real weight, food or health data. Fixtures use made-up people. Never commit secrets; supply them through environment variables.

Personal names and hosts are checked by gitleaks on pushes and same-repo PRs with a custom rule kept in the `TARE_GITLEAKS_TOML` secret. Fork PRs and Dependabot runs use default rules only; main re-checks after merge. To locate a finding locally, run `gitleaks git . --config <path-to-config> --redact -v`. Without the config, run `gitleaks git . --redact -v` for default rules only.

Use TypeScript only. Tests run with `node --test`.

## Layout

- `packages/engine`: Node + Hono backend.
- `packages/engine/src/db.ts`: the only module that opens the SQLite driver; it also runs migrations.
- `packages/engine/migrations`: schema in numbered `.sql` migrations.
  Start table rebuild migrations with `-- tare:rebuild` on the first line to disable foreign keys before the transaction and check them before commit.
- `packages/engine/src/queries`: queries in `.sql` files with TypeSQL-generated types.
- `apps/*`: application workspaces.

SQLite only. No ORM. Parameters only: never insert values into SQL strings. Every query is exercised by a test against a real migrated SQLite database. Commit generated query files and regenerate them after changing SQL or migrations.

## Commands

Use Node 22 (at least 22.18) and pnpm 11.2.2. Run these from the repository root:

- Install: `pnpm install`
- Lint and format check: `pnpm lint`
- Apply formatting: `pnpm format`
- Typecheck all workspaces: `pnpm typecheck`
- Test all workspaces: `pnpm test` (runs `node --test`)
- Regenerate query types: `pnpm generate`
- Run engine: optionally copy `.env.example` to `.env`, or set environment variables, then `pnpm --filter @tare/engine start`
- Health check: `curl -s localhost:3000/health`

Biome handles linting and formatting for the workspace. TypeScript runs in strict mode. Node strips TypeScript types directly; there is no build step or type-stripping flag.

## Configuration

`DATABASE_URL` is required and is a SQLite file path, or `:memory:` for an ephemeral database. Surrounding whitespace is trimmed. Relative paths resolve from the engine process working directory (`packages/engine` when using the workspace command). Parent directories are created automatically. Startup applies migrations before listening.

`PORT` defaults to `3000` and must be an integer from 1 to 65535. `.env.example` lists both variables with safe local values. The startup command loads the root `.env` file if it exists; process environment variables can override it. Set the required variables in the process environment when running without a file.

TypeSQL generation uses an ignored local database at `packages/engine/data/typesql.sqlite`. Biome formats generated code and permits the generator's explicit `any` type in query output.

Keep comments short and focused on why. Use descriptive identifiers, never single-letter names. Keep personal data and secrets out of logs as well as source and fixtures.

## Known TypeSQL gaps

TypeSQL CLI 0.24.0 generates these queries without error but loses result types:

- LEFT JOIN: generated `LeftJoinResult.name` is `string`; an unmatched row returns `null`. Use the `left-join.mts` wrapper with `string | null`.
- `json_extract`: generated `JsonResult.name` is `any | null`; callers lose type checking. Use the `json.mts` wrapper with `unknown` and narrow the result before using it.

Both wrappers and their SQL files live in `packages/engine/test/compat/`, outside the generated set. Other compatibility shapes use generated functions. For future queries built at runtime from many optional filters, Kysely is allowed under ruling `tare-kysely-if-dynamic`.

`src/queries/compat/` and the compat fixture are test-only, never import them from engine code, and generation also loads `test/fixtures/typesql-compat.sql`, a test-only schema that is not a migration.

SQLite RETURNING row order is unspecified; callers sort the returned rows if they need an order.
