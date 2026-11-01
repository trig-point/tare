## Context

The engine scaffold is merged: a Hono server on Node 22, SQLite through better-sqlite3, numbered `.sql` migrations with a small runner, queries in `.sql` files typed by TypeSQL 0.24.0, Biome, and one CI job. Version 1 is built for one operator and must work for anyone who self-hosts it, so every host, key, path and account name comes from configuration.

Constraints that shape every decision below:

- Nutrition numbers are deterministic. A model may read an email to find meal names and quantities; it never produces calories or macros.
- Every nutrition value carries a provenance: `verified` (USDA lab data), `label` (a manufacturer or provider panel, including one a person typed in), or `estimated` (anything else).
- The repository is public. No personal data, hostnames, home paths or secrets in source, fixtures or docs.
- The reference install sits behind an identity-aware proxy (Cloudflare Access with a one-time PIN for browsers). Tare also has its own login, so it works without one.

## Goals / Non-Goals

**Goals:**

- Several people on one install, each with their own data, login, agent tokens and Home Assistant device.
- Logging from the PWA, from an AI agent over MCP, from a barcode, from a forwarded meal-kit email, and from a Bluetooth scale through Home Assistant.
- A daily target that starts from a formula and becomes adaptive once there is enough clean data.
- A meal plan of slots that agents fill and Tare tracks.
- Each piece lands as one reviewable pull request.

**Non-Goals:**

- A pantry or a pantry-aware meal solver (post version 1).
- Reading health data from the phone directly; activity and sleep arrive server-side.
- Feeding activity data into the calorie target (version 1 shows it beside intake only).
- Offline editing and deleting; the version 1 offline queue holds new entries only.
- Code that reads any meal-kit or delivery provider's website. Agents outside this repository may supply values over MCP.

## Decisions

### Operations are defined once

Each operation (name, input and output schema, handler, required scope) lives in one registry. HTTP routes and MCP tools are generated from it, and a contract test fails if an operation is missing from either. Every write takes an explicit `provenance`; a food logged without a catalog food defaults to `estimated`, because an agent's numbers are its own estimate. Alternative considered: hand-written routes with an MCP wrapper. Rejected because the two surfaces would drift.

### Two credentials at the proxy, one identity in Tare

Browsers pass the proxy with its one-time PIN. Agents pass it with a proxy service token (two headers) and then present a Tare agent token, which decides which person they act for. The PWA sends `X-Requested-With: XMLHttpRequest`, so an expired proxy session returns 401 instead of a login page. Home Assistant and the inbound email sender reach Tare on the local network. Alternatives considered: exempting `/api` and `/mcp` from the proxy, or no proxy. The operator chose to keep the whole host behind the proxy. A spike on the real proxy records each route's response before the MCP and offline-queue tasks merge.

### The offline queue never drops an entry

Writes go to IndexedDB first, each with a client-generated id, bound to the signed-in user. Replay happens on launch, on reconnect and after sign-in. The server treats a repeated client id as the same write and returns the stored row. A queued entry is removed only after a JSON acknowledgement; a 401, a redirect or an HTML body means "sign in again" and the entry stays. The service worker never caches HTML it did not build. Alternative considered: Workbox background sync alone. Rejected as the only path because it is not guaranteed and cannot distinguish an expired session.

### Tenant isolation is structural

Personal tables carry a NOT NULL `user_id`. Owned children reference `(user_id, id)` composite keys so a row cannot point at another person's parent. Queries take the authenticated user as a parameter from a helper, never from the request body. Two-user negative tests exercise reads, totals, exports and background jobs. Alternative considered: a lint that checks query text for `user_id`. Rejected because it passes unsafe joins and cannot see child references.

### The data layer stays as built, with a compatibility file

TypeSQL is pinned at 0.24.0 with the existing invalid-SQL guard. A compatibility test file generates and runs one query of each shape Tare needs (RETURNING with 0, 1 and many rows, upsert, LEFT JOIN nullability, CTE, window function, JSON function, empty `IN` list). A shape that fails is recorded once and handled with a hand-typed wrapper or Kysely under the existing ruling. The migration runner gains checksums of applied files and a rebuild path that disables foreign keys before `BEGIN`, because `PRAGMA foreign_keys` does nothing inside a transaction. One writer connection, WAL, `foreign_keys=ON`, `busy_timeout` 5000. Alternatives considered: sqlc's TypeScript plugin (Beta for SQLite) and `node:sqlite` (not yet stable). Neither justifies switching now.

### The nutrition chain only accepts exact matches

Resolution order: known foods, then USDA FoodData Central, then Open Food Facts, then a question. A similar-named generic food is not the meal that was delivered, so a miss becomes a question rather than a guess. Each adapter emits only its own provenance class. Open Food Facts is called only for a barcode or an explicit "search online" action (it allows 10 searches a minute), with the required User-Agent and results cached in the catalog.

### Meal-kit orders are reconciled per delivery week

Providers send more than one email per order. The reference provider sends a scheduling email (meals, chef, quantity, delivery date) and a processed email at cutoff (meals and quantity only). The parser extracts each email into a fixed schema with a short evidence excerpt per field that must occur in the email. Reconciliation merges emails into one order per service and delivery week, lets the processed list supersede the scheduled one, and takes the date from the scheduling email or asks. Deduplication uses message hashes and order keys, never the model. The parser has no tools and fetches nothing. With no model configured, an email becomes a question instead of being dropped. Fixtures are synthetic emails that copy real layouts with made-up meals and people.

### A day counts only after the person signs it off

Each user has a timezone and a day-start hour (default 4 AM), so a late snack lands in the right day. Closing a day is a screen in the PWA that shows the day's ledger and takes hunger, fullness and notes; only the signed-in person can sign off; agent tokens cannot. The adaptive TDEE uses signed-off days only and keeps the formula target until enough exist. Imported days arrive unsigned and get a bulk review list.

### Adaptive TDEE is energy balance over clean days

Average intake over a rolling window of signed-off days, minus the trend weight change times an energy density, gives the estimate. Intake marked `estimated` widens the uncertainty band using its stored low and high values. A minimum-data rule decides eligibility; until then the formula stands and the target shows a "learning" state.

### Home Assistant gets stable entities and specific buttons

One MQTT device per person with identifiers built from an install id and the Tare user id, `default_entity_id` for readable names, discovery re-published on Home Assistant's birth message, and an empty retained config on user deletion. kcal sensors carry no `total_increasing` state class, because edits would read as meter resets. Buttons carry the item id and a revision; the engine rejects stale revisions and publishes the result. A shared Home Assistant publishes every press under its own broker identity, so the household behind one Home Assistant is trusted, and the setup docs say so.

### Oura is OAuth per install with locked refresh

Each install registers its own Oura OAuth app (up to 10 users before Oura review). Refresh tokens are single-use, so refresh runs under a per-user lock and saves both new tokens atomically. Membership errors are shown separately from authorization errors. Version 1 polls daily and maps only documented daily fields.

## Risks / Trade-offs

- [Proxy behavior differs from the docs] → The proxy spike records real responses from the installed PWA and from each agent client before dependent tasks merge.
- [TypeSQL misses a needed SQL shape] → The compatibility file finds it once; the fallback is a hand-typed wrapper or Kysely.
- [Meal-kit email layouts change] → Evidence excerpts and schema validation turn a changed layout into questions rather than wrong data.
- [Unknown meals pile up as questions] → The catalog keys answers by meal and chef, so each meal asks once; agents can answer over MCP.
- [Partial logging corrupts the TDEE] → Only signed-off days count.
- [Broker ACLs silently not enforced] → A real deny test on the deployed broker before Home Assistant tasks merge.
- [Oura token rotation races] → Per-user lock and atomic save.
- [Server-side calendar fetch] → The day-type calendar rule fetches only a configured HTTPS URL, rejects private network targets, caches results, and falls back to the manual day type.

## Migration Plan

There is no installed base. The placeholder migration from the scaffold is replaced before the first install; after the first install, migrations are append-only with checksums. The operator's existing interim logs (JSON lines for intake, weight and day notes) are imported once with the importer command into the operator's account; imported days arrive unsigned.

## Open Questions

- Which Bluetooth scale variant the reference install uses; the scale task starts by capturing a real MQTT payload.
- Whether Codex's MCP client can send the proxy's service-token headers; the proxy spike answers it.
