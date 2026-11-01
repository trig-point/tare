# Tare

This repository is public. Never add personal data, including real weight, food or health data. Fixtures use made-up people. Never commit secrets; supply them through environment variables.

Use TypeScript only. Tests run with `node --test`.

## Layout

- `packages/engine`: Node + Hono backend.
- `packages/engine/src/db.ts`: the only module that opens the SQLite driver; it also runs migrations.
- `packages/engine/migrations`: schema in numbered `.sql` migrations.
- `packages/engine/src/queries`: queries in `.sql` files with TypeSQL-generated types.
- `apps/*`: application workspaces.

SQLite only. No ORM. Kysely (a query builder) is allowed only for a query built at runtime from many optional filters. Parameters only: never insert values into SQL strings. Every query is exercised by a test against a real migrated SQLite database. Commit generated query files and regenerate them after changing SQL or migrations.

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
