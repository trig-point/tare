# Tare

This repository is public. Never add personal data, including real weight, food or health data. Fixtures use made-up people. Never commit secrets; supply them through environment variables.

Use TypeScript only. Tests run with `bun test`.

## Layout

- `packages/engine`: Bun + Hono backend.
- `packages/engine/src/db.ts`: database driver and migration wiring. Keep driver-specific code here; application code uses Drizzle, with no SQLite-only SQL.
- `packages/engine/migrations`: the foundation table migration. Product schema comes later.
- `apps/*`: application workspaces.

## Commands

Use Bun 1.2.18. Run these from the repository root:

- Install: `bun install`
- Lint and format check: `bun run lint`
- Apply formatting: `bun run format`
- Typecheck all workspaces: `bun run typecheck`
- Test all workspaces: `bun test` (also `bun run test`)
- Run engine: copy `.env.example` to `.env`, then `bun run --filter @tare/engine start`
- Health check: `curl -s localhost:3000/health`

Biome handles linting and formatting for the workspace. TypeScript runs in strict mode.

## Configuration

`DATABASE_URL` is required and is a SQLite file path, or `:memory:` for an ephemeral database. Relative paths resolve from the engine process working directory (`packages/engine` when using the workspace command). Parent directories are created automatically. Startup applies migrations before listening.

`PORT` defaults to `3000` and must be an integer from 1 to 65535. `.env.example` lists both variables with safe local values. The startup command loads the root `.env` file; process environment variables can override it.

Keep comments short and focused on why. Use descriptive identifiers, never single-letter names. Keep personal data and secrets out of logs as well as source and fixtures.
