## 1. Foundation

- [x] 1.1 Engine scaffold: pnpm workspace, Hono with /health, typed config, better-sqlite3 migration runner with applied-file checksums, TypeSQL codegen with orphan guard, one CI job; landed in PR #2 (complexity: standard) (gate: none)
- [x] 1.2 Migration rebuild path: a table-rebuild helper that turns foreign keys off before BEGIN, runs foreign_key_check before commit and turns foreign keys back on after, plus fresh-replay and populated-upgrade tests; checksums of applied files already landed in 1.1; landed in PR #5 (depends on: 1.1) (complexity: standard) (gate: none)
- [ ] 1.3 Core schema in a new migration that drops the scaffold's placeholder table, leaving 0001 unedited: users with timezone and day-start hour, the shared source cache and person-owned foods, intake entries with eaten-at time, stored day, per-person client id, provenance and low and high values, weights with body fat, days with sign-off and notes, composite owner keys (depends on: 1.2, 1.4) (complexity: judgment) (gate: none)
- [x] 1.4 TypeSQL compatibility file: generate and run RETURNING with 0, 1 and many rows, upsert, LEFT JOIN nullability, CTE, window function, JSON function and empty IN; landed in PR #4 (depends on: 1.1) (complexity: standard) (gate: none)
- [ ] 1.5 Users and sessions: scrypt password hashes, HTTP-only SameSite=Lax session cookie (Secure over HTTPS) with a configured lifetime, sign-out, X-Requested-With required on cookie-authenticated writes, first user from configuration, startup error when the database is empty and those settings are missing, administrator adds a user (depends on: 1.3) (complexity: judgment) (gate: none)
- [ ] 1.6 Agent tokens and tenant tests: hashed named revocable tokens with last-used time, query helpers that take the authenticated person, a reusable two-user test helper, two-user negative tests over HTTP for users, sessions and tokens (depends on: 1.5) (complexity: judgment) (gate: none)
- [ ] 1.7 Operation registry and HTTP routes: one definition per operation with a caller class (session only, or session and agent token) and an administrator flag, JSON errors with stable codes, provenance rules on nutrition writes (depends on: 1.6) (complexity: standard) (gate: none)
- [ ] 1.8 MCP server at /mcp from the registry: agent-token auth, only agent-callable operations listed, Origin check, MCP session bound to its token's person, contract test that every agent-callable operation is a tool and every operation an HTTP route (depends on: 1.7, 1.14) (complexity: judgment) (gate: none)
- [ ] 1.9 Repository hygiene check in CI: absolute home paths and denied hostnames from tracked generic patterns plus a CI variable, planted-fixture red test (depends on: 1.1) (complexity: standard) (gate: none)
- [ ] 1.10 PWA app shell: React, Vite and TanStack Router app served by the engine, manifest, icons, service worker that never caches foreign HTML, sign-in and sign-out (depends on: 1.5) (complexity: standard) (gate: none)
- [ ] 1.11 PWA offline write queue: IndexedDB queue bound to the signed-in person, client ids and eaten-at times, replay on launch, reconnect and sign-in, requests with redirect manual, pending, synced, sign-in-needed and rejected states in an app-shell status indicator, rejected entries kept until edited or discarded, persistent storage requested, creates only (depends on: 1.10, 2.4, 1.14) (complexity: judgment) (gate: none)
- [ ] 1.12 Container image: Dockerfile and compose example that build and run the engine and the app, health check, data volume, environment reference including the HTTPS requirement for install, camera and secure cookies, clean install on the image's base OS (depends on: 1.10) (complexity: standard) (gate: none)
- [ ] 1.13 Nightly backup job: online SQLite backup to a configured folder outside the data volume, retention, restore test with integrity and foreign-key checks and an authenticated read (depends on: 1.5, 1.16) (complexity: standard) (gate: none)
- [ ] 1.14 SPIKE (no PR): early identity-proxy probe. Run the container behind the reference install's proxy with browser one-time PIN and agent service-token policies; record the responses for /health, the manifest and app shell from an installed phone PWA, an /api route with an expired proxy session sent with and without X-Requested-With, and a request to /mcp carrying the service-token headers from each agent client (the engine's own 404 there proves the headers passed the proxy). Done when every response is recorded and the policy is written down (depends on: 1.12) (complexity: judgment) (gate: none)
- [ ] 1.15 OPS (no PR): reference install on the operator's host behind the proxy, with the client smoke test. Done when the PWA installs on the operator's phone, each agent client logs a food through /mcp, and an entry queued offline replays after the proxy session expires and the person signs in again (depends on: 1.8, 2.5) (complexity: standard) (gate: none)
- [ ] 1.16 Job runner: named in-process jobs on daily or weekly schedules in the install's configured timezone, one run at a time per job, last run and result recorded, an injectable clock for tests (depends on: 1.1) (complexity: standard) (gate: none)

## 2. Logging

- [ ] 2.1 Nutrition contract and exact-match resolver in packages/nutrition: identity and serving rules, unknown never stored as zero, provenance per value, no database access (callers pass data in) (depends on: 1.3) (complexity: standard) (gate: none)
- [ ] 2.2 Open Food Facts adapter: barcode lookup, configured User-Agent, at most 100 product reads and 10 searches a minute, results for the shared source cache, leading-zero normalization (depends on: 2.1) (complexity: standard) (gate: none)
- [ ] 2.3 USDA FoodData Central adapter: API key from configuration, explicit search over Foundation, SR Legacy and Branded data only, Foundation and SR Legacy as verified and Branded as label, results for the shared source cache (depends on: 2.1) (complexity: standard) (gate: none)
- [ ] 2.4 Logging write operations: log_food, log_weight, edit and delete entry, provenance rules, idempotent by per-person client id, day assigned from eaten-at time with the person's timezone and day start and stored, write transactions with BEGIN IMMEDIATE (depends on: 1.7, 2.1) (complexity: judgment) (gate: none)
- [ ] 2.5 PWA today and weight screens, including edit and delete of entries (depends on: 1.11, 2.13) (complexity: standard) (gate: none)
- [ ] 2.6 PWA add food: catalog search, explicit search online, quick add calories and protein (depends on: 2.5, 2.12) (complexity: standard) (gate: none)
- [ ] 2.7 PWA day sign-off: ledger review, hunger, fullness and notes, complete marker, a list of unsigned past days to review in turn (depends on: 2.5, 2.14) (complexity: standard) (gate: none)
- [ ] 2.8 PWA barcode scanning: native detector when it supports EAN-13, UPC-A, EAN-8 and UPC-E, self-hosted precached WASM reader otherwise, manual entry, installed-phone acceptance (depends on: 2.6, 2.12) (complexity: standard) (gate: none)
- [ ] 2.9 Regular meals: person-owned saved meals with values, an uncertainty range and a baseline source, invisible to other people, log_regular_meal, two-user test (depends on: 2.4, 2.13) (complexity: standard) (gate: none)
- [ ] 2.10 One-time importer command for intake, weight and day-note JSON lines into a named person, through the engine's database module, idempotent, days imported unsigned (depends on: 2.4) (complexity: standard) (gate: none)
- [ ] 2.11 OPS (no PR): import the operator's interim logs and historical weigh-ins. Done when Tare's daily totals and weight history match the source files (depends on: 2.10, 1.15) (complexity: mechanical) (gate: none)
- [ ] 2.12 Online lookup operations: lookup_barcode and search_online through the adapters, exact matches only and no automatic substitution, results written to the shared source cache, two-user test that cached results are shared and person-owned foods are not (depends on: 2.2, 2.3, 1.7) (complexity: standard) (gate: none)
- [ ] 2.13 Logging read operations: today with totals, find_food over the person's own foods and the shared source cache (depends on: 2.4) (complexity: standard) (gate: none)
- [ ] 2.14 Day sign-off operations: sign_off_day for sessions only, add_day_note for agents too, a database trigger that clears a day's sign-off on any change to its intake, tests for agent rejection and for the reset (depends on: 2.4) (complexity: judgment) (gate: none)
- [ ] 2.15 PWA account settings: a timezone and day-start hour screen with the operation that saves them, plus screens over the token operations from 1.6 (create and show once, last used, revoke) and the add-user operation from 1.5 for administrators (depends on: 2.5) (complexity: standard) (gate: none)

## 3. Formula target

- [ ] 3.1 Profile and formula target operations: height, birth date, sex, activity level, goal rate and protein factor per person, Mifflin-St Jeor with the activity factor table, goal adjustment, protein target and rounding as specified, today returns target and remaining (depends on: 2.13, 3.2) (complexity: standard) (gate: none)
- [ ] 3.2 Weight trend: exponentially smoothed trend with factor 0.1 on days with a reading, held through gaps (depends on: 1.3) (complexity: standard) (gate: none)
- [ ] 3.3 PWA profile form, weight trend chart and target card (depends on: 3.1, 2.5) (complexity: standard) (gate: none)

## 4. Meal kits

- [ ] 4.1 Questions queue: table, list and answer operations over HTTP and MCP, questions with no owning person routed to administrators (depends on: 1.7) (complexity: standard) (gate: none)
- [ ] 4.2 PWA questions screen (depends on: 4.1, 2.5) (complexity: standard) (gate: none)
- [ ] 4.3 Orders and meals on hand: orders by service and delivery date, on-hand meals with quantity and revision, mark_delivery, one function that creates on-hand meals for every caller (depends on: 1.7) (complexity: standard) (gate: none)
- [ ] 4.4 Order-email parser in packages/order-parser: OpenAI-compatible client from configuration, fixed schema with evidence excerpts, nullable chef and delivery date, synthetic fixtures copying real layouts, questions when uncertain or when no model is configured (depends on: 4.1) (complexity: judgment) (gate: none)
- [ ] 4.5 Inbound order email endpoint: per-person token, 5 MB limit with text and HTML parts only, nothing the email links to fetched, DKIM signature verified by Tare for the service's configured sender domain (headers never trusted), unverified emails held for the person's confirmation, per-person message dedupe (depends on: 4.4) (complexity: judgment) (gate: none)
- [ ] 4.6 Order reconciliation: one order per service and delivery date, a processed list supersedes the scheduled one and attaches to the person's next scheduled delivery for that service, chef carried over by meal name, a question when no order matches (depends on: 4.5, 4.3) (complexity: standard) (gate: none)
- [ ] 4.7 New-meal nutrition questions: on-hand meal creation raises a question for a meal with no known nutrition, answered by a person or an agent with label values and a source, answers stored as that person's foods keyed by service, meal name and chef (depends on: 4.1, 4.3, 2.1) (complexity: standard) (gate: none)
- [ ] 4.8 OPS (no PR): the operator's mail rule forwards order emails to the inbound endpoint over the local network. Done when one real order produces one order with meals on hand and a question for each new meal (depends on: 4.6, 4.7, 1.15) (complexity: mechanical) (gate: none)
- [ ] 4.9 Meal action on on-hand meals: eat_meal with ate and ate 3/4 by meal id and revision, intake entry and quantity change in one transaction, stale revision rejected, idempotent by per-person mutation id (depends on: 4.3, 2.4) (complexity: judgment) (gate: none)

## 5. Adaptive target

- [ ] 5.1 Adaptive TDEE: mean intake of the signed-off days in a 28-day window minus the trend's weight change per elapsed day times 7,700 kcal/kg, low and high bounds from estimated entries, eligibility at 14 signed-off days and 8 weigh-ins in the window, formula kept until eligible, learning state, these numbers as configuration defaults (depends on: 3.1, 2.14) (complexity: judgment) (gate: none)
- [ ] 5.2 Weekly recompute job and store of each person's targets (depends on: 5.1, 1.16) (complexity: standard) (gate: none)

## 6. Health signals

- [ ] 6.1 Daily signals store with the fixed vocabulary, manual and agent entry (log_signal, log_activity) (depends on: 1.7) (complexity: standard) (gate: none)
- [ ] 6.2 Oura connect: per-install OAuth app from configuration, connect and callback with a single-use state bound to the person who started it, tokens encrypted with a configured secret key, restore test with and without the key (depends on: 6.1, 1.13) (complexity: judgment) (gate: none)
- [ ] 6.3 Oura daily sync job in packages/health-sources: daily_activity, sleep, daily_sleep, daily_readiness, daily_stress and workout mapped into the signals vocabulary, last sync recorded per person (depends on: 6.5, 1.16) (complexity: standard) (gate: none)
- [ ] 6.4 PWA health signals: signals beside the day's intake, Oura connect, last-sync time, membership and authorization errors shown apart (depends on: 6.3, 2.5) (complexity: standard) (gate: none)
- [ ] 6.5 Oura token refresh: per-person lock, atomic save of both tokens, membership errors reported separately from authorization errors (depends on: 6.2) (complexity: judgment) (gate: none)

## 7. Home Assistant

- [ ] 7.1 OPS (no PR): Tare's MQTT user and ACL on the operator's broker. Done when a real deny test on the deployed broker version shows Tare can use only its own topic prefix, the discovery prefix, Home Assistant's status topic and the configured scale topic (complexity: judgment) (gate: none)
- [ ] 7.2 MQTT discovery publisher: device per person, stable ids and default entity ids, sensors for target, remaining, today and weight trend, state re-published after edits, discovery re-published on Home Assistant's online message, no meter state class on kcal (depends on: 3.1, 7.1) (complexity: standard) (gate: none)
- [ ] 7.3 On-hand meal buttons: ate it and ate 3/4 per on-hand meal calling eat_meal, discovery re-published when a meal or its revision changes and removed when the meal is gone, a last-press result sensor (depends on: 7.2, 4.9) (complexity: standard) (gate: none)
- [ ] 7.4 Scale weigh-ins from MQTT: capture a real payload first, weigh-ins from the configured topic, scale user to person mapping from configuration, repeats within 10 minutes kept once, unmapped readings and readings outside 20 to 350 kg or more than 3 kg from the trend become questions (depends on: 7.2, 2.4, 4.1) (complexity: standard) (gate: none)
- [ ] 7.5 TDEE estimate sensor and weekly target notice: an event entity in Home Assistant and an in-app notice on the today screen (depends on: 5.2, 7.2, 2.5) (complexity: standard) (gate: none)
- [ ] 7.6 Example Home Assistant dashboard and setup docs, including the shared-dashboard trust model (depends on: 7.3) (complexity: mechanical) (gate: none)

## 8. Meal plan

- [ ] 8.1 Day templates, slots and day types with a manual day-type choice (depends on: 3.1) (complexity: standard) (gate: none)
- [ ] 8.2 Calendar day-type rule: a per-person HTTPS feed URL kept secret, every resolved address checked public, redirects not followed, 10-second timeout and 1 MB limit, cached for an hour, manual fallback (depends on: 8.1) (complexity: judgment) (gate: none)
- [ ] 8.3 Slot budgets: entries assigned to slots by planned-item action or time window, unused or overspent budget spread over later slots by share, next_slot operation (depends on: 8.1) (complexity: standard) (gate: none)
- [ ] 8.4 Planned items: plan_slot for agents, planned items with a revision that reference an on-hand meal or a food (depends on: 8.3, 4.3) (complexity: standard) (gate: none)
- [ ] 8.5 PWA slot view with budgets, planned items and meal actions (depends on: 8.7, 2.5) (complexity: standard) (gate: none)
- [ ] 8.6 Suggested slot shares from 14 or more signed-off days of slot-assigned intake, accepted or ignored in the slot view (depends on: 8.5, 2.14) (complexity: standard) (gate: none)
- [ ] 8.7 Meal action on planned items: ate, ate 3/4 and skip by planned item id and revision; ate and ate 3/4 log 1 and 0.75 of the item's nutrition and take one from its on-hand meal in the same transaction; skip logs nothing and moves no stock; idempotent by mutation id (depends on: 8.4, 4.9) (complexity: judgment) (gate: none)
- [ ] 8.8 Home Assistant planned-item buttons and next-slot sensor (depends on: 8.7, 7.3) (complexity: standard) (gate: none)
