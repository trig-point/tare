## 1. Foundation

- [x] 1.1 Engine scaffold: pnpm workspace, Hono with /health, typed config, better-sqlite3 migration runner, TypeSQL codegen with orphan guard, one CI job; landed in PR #2 (complexity: standard) (gate: none)
- [ ] 1.2 Migration runner safety: checksums of applied files, failure on edited or missing files, a rebuild path that turns foreign keys off before BEGIN and checks them before commit, fresh-replay and populated-upgrade tests (depends on: 1.1) (complexity: standard) (gate: none)
- [ ] 1.3 Core schema: users with timezone and day-start hour, shared foods catalog, intake entries with client id and provenance, weights with body fat, days with sign-off and notes, composite owner keys; replaces the scaffold placeholder (depends on: 1.2) (complexity: judgment) (gate: none)
- [ ] 1.4 TypeSQL compatibility file: generate and run RETURNING with 0, 1 and many rows, upsert, LEFT JOIN nullability, CTE, window function, JSON function and empty IN (depends on: 1.1) (complexity: standard) (gate: none)
- [ ] 1.5 Users and sessions: password login, HTTP-only session cookie, first user from configuration, administrator adds a user (depends on: 1.3) (complexity: judgment) (gate: none)
- [ ] 1.6 Agent tokens and tenant tests: hashed named revocable tokens, query helpers that take the authenticated person, two-user negative tests over HTTP (depends on: 1.5) (complexity: judgment) (gate: none)
- [ ] 1.7 Operation registry and HTTP routes: one definition per operation, JSON errors with stable codes, provenance required on nutrition writes (depends on: 1.6) (complexity: standard) (gate: none)
- [ ] 1.8 MCP server at /mcp from the registry, agent-token auth, contract test that every operation is a tool (depends on: 1.7) (complexity: judgment) (gate: none)
- [ ] 1.9 Repository hygiene check in CI: absolute home paths and denied hostnames from tracked generic patterns plus a CI variable, planted-fixture red test (depends on: 1.1) (complexity: standard) (gate: none)
- [ ] 1.10 PWA app shell: React, Vite and TanStack Router app served by the engine, manifest, icons, service worker that never caches foreign HTML, sign-in screen (depends on: 1.5) (complexity: standard) (gate: none)
- [ ] 1.11 PWA offline write queue: IndexedDB queue bound to the signed-in person, client ids, replay on launch, reconnect and sign-in, pending, synced, sign-in-needed and rejected states, creates only (depends on: 1.10, 2.4) (complexity: judgment) (gate: none)
- [ ] 1.12 Container image: Dockerfile, compose example, health check, data volume, environment reference, clean install on the image's base OS (depends on: 1.1) (complexity: standard) (gate: none)
- [ ] 1.13 Nightly backup: online SQLite backup to a configured folder outside the data volume, retention, restore test with integrity and foreign-key checks and an authenticated read (depends on: 1.3) (complexity: standard) (gate: none)
- [ ] 1.14 SPIKE (no PR): identity-proxy probe. Run the engine behind the reference install's proxy with browser one-time PIN and agent service-token policies; record responses for /health, /mcp and the manifest from an installed phone PWA with an expired session and from each agent client. Done when every route has a recorded response and the policy is written down (depends on: 1.12) (complexity: judgment) (gate: none)
- [ ] 1.15 OPS (no PR): reference install on the operator's host behind the proxy. Done when the PWA installs on the operator's phone and an agent logs a food through /mcp (depends on: 1.14, 1.10, 1.8) (complexity: standard) (gate: none)

## 2. Logging

- [ ] 2.1 Nutrition contract and exact-match resolver in packages/nutrition: identity and serving rules, unknown never stored as zero, provenance per value (depends on: 1.3) (complexity: standard) (gate: none)
- [ ] 2.2 Open Food Facts adapter: barcode lookup, configured User-Agent, documented rate limits, catalog cache, leading-zero normalization (depends on: 2.1) (complexity: standard) (gate: none)
- [ ] 2.3 USDA FoodData Central adapter: API key from configuration, explicit search only, catalog cache (depends on: 2.1) (complexity: standard) (gate: none)
- [ ] 2.4 Logging operations: log_food, log_weight, today, find_food, edit and delete entry, idempotent by client id, per-person day boundary (depends on: 1.7, 2.1) (complexity: standard) (gate: none)
- [ ] 2.5 PWA today and weight screens (depends on: 1.11, 2.4) (complexity: standard) (gate: none)
- [ ] 2.6 PWA add food: catalog search, explicit search online, quick add calories and protein, edit and delete (depends on: 2.5) (complexity: standard) (gate: none)
- [ ] 2.7 PWA day sign-off: ledger review, hunger, fullness and notes, complete marker for signed-in people only, bulk review of imported days (depends on: 2.5) (complexity: standard) (gate: none)
- [ ] 2.8 PWA barcode scanning: native detector when it supports EAN-13, UPC-A, EAN-8 and UPC-E, self-hosted precached WASM reader otherwise, manual entry, installed-phone acceptance (depends on: 2.6, 2.2) (complexity: standard) (gate: none)
- [ ] 2.9 Regular meals: saved named meals with values, range and baseline source as known foods, log_regular_meal (depends on: 2.4) (complexity: standard) (gate: none)
- [ ] 2.10 One-time importer command for intake, weight and day-note JSON lines into a named person, idempotent, days imported unsigned (depends on: 2.4) (complexity: standard) (gate: none)
- [ ] 2.11 OPS (no PR): import the operator's interim logs and historical weigh-ins. Done when Tare's daily totals and weight history match the source files (depends on: 2.10, 1.15) (complexity: mechanical) (gate: none)

## 3. Formula target

- [ ] 3.1 Profile and formula target: height, birth date, sex, activity level, goal rate, Mifflin-St Jeor with activity factor, protein target, remaining shown in today (depends on: 2.4) (complexity: standard) (gate: none)
- [ ] 3.2 Weight trend: smoothed trend over weigh-ins with gap handling (depends on: 1.3) (complexity: standard) (gate: none)
- [ ] 3.3 PWA weight trend chart and target card (depends on: 3.1, 3.2, 2.5) (complexity: standard) (gate: none)

## 4. Meal kits

- [ ] 4.1 Questions queue: table, list and answer operations over HTTP and MCP (depends on: 1.7) (complexity: standard) (gate: none)
- [ ] 4.2 PWA questions screen (depends on: 4.1, 2.5) (complexity: standard) (gate: none)
- [ ] 4.3 Orders and meals on hand: orders by service and delivery week, on-hand meals, mark_delivery, eat one with intake and stock in one transaction (depends on: 2.4) (complexity: standard) (gate: none)
- [ ] 4.4 Order-email parser in packages/order-parser: OpenAI-compatible client from configuration, fixed schema with evidence excerpts, nullable delivery date, synthetic fixtures copying real layouts, questions when uncertain or when no model is configured (depends on: 4.1) (complexity: judgment) (gate: none)
- [ ] 4.5 Inbound order email endpoint: per-person token, size and MIME limits, no remote fetches, sender verification recorded, message dedupe (depends on: 4.4) (complexity: judgment) (gate: none)
- [ ] 4.6 Order reconciliation: one order per service and delivery week, processed list supersedes scheduled, delivery date from the email that states it or a question (depends on: 4.5, 4.3) (complexity: standard) (gate: none)
- [ ] 4.7 New-meal nutrition questions: unknown meals raise a question answerable by a person or an agent, answers enter the catalog keyed by service, meal and chef (depends on: 4.1, 4.3, 2.1) (complexity: standard) (gate: none)
- [ ] 4.8 OPS (no PR): the operator's mail rule forwards order emails to the inbound endpoint over the local network. Done when one real order produces one order with meals on hand (depends on: 4.6, 1.15) (complexity: mechanical) (gate: none)

## 5. Adaptive target

- [ ] 5.1 Adaptive TDEE: energy balance over signed-off days only, wider uncertainty for estimated intake, minimum-data rule, formula kept until eligible, learning state (depends on: 3.1, 3.2, 2.7) (complexity: judgment) (gate: none)
- [ ] 5.2 Weekly recompute and store of each person's targets (depends on: 5.1) (complexity: standard) (gate: none)

## 6. Health signals

- [ ] 6.1 Daily signals store with the fixed vocabulary, manual and agent entry (log_activity), shown next to intake (depends on: 1.7) (complexity: standard) (gate: none)
- [ ] 6.2 Oura connect: per-install OAuth app from configuration, callback route, encrypted token store, per-person refresh lock with atomic save, membership errors shown separately (depends on: 6.1, 1.5) (complexity: judgment) (gate: none)
- [ ] 6.3 Oura daily sync of documented daily fields into the signals vocabulary, last-sync time shown (depends on: 6.2) (complexity: standard) (gate: none)

## 7. Home Assistant

- [ ] 7.1 OPS (no PR): Tare's MQTT user and ACL on the operator's broker. Done when a real deny test shows Tare cannot publish or subscribe outside its topics on the deployed broker version (complexity: judgment) (gate: none)
- [ ] 7.2 MQTT discovery publisher: device per person, stable ids and default entity ids, sensors for target, remaining, today, weight trend and TDEE estimate, birth-message replay, no meter state class on kcal (depends on: 5.2, 7.1) (complexity: standard) (gate: none)
- [ ] 7.3 On-hand item buttons: ate it, ate 3/4 and skip with item id and revision, stale presses rejected, result published (depends on: 7.2, 4.3) (complexity: standard) (gate: none)
- [ ] 7.4 Scale weigh-ins from MQTT: capture a real payload first, scale user to person mapping from configuration, dedupe window, unmapped or implausible readings become questions (depends on: 7.2, 2.4, 4.1) (complexity: standard) (gate: none)
- [ ] 7.5 Weekly target notice to Home Assistant and the app (depends on: 5.2, 7.2) (complexity: standard) (gate: none)
- [ ] 7.6 Example Home Assistant dashboard and setup docs, including the shared-dashboard trust model (depends on: 7.3) (complexity: mechanical) (gate: none)

## 8. Meal plan

- [ ] 8.1 Day templates, slots and day types with a manual day-type choice (depends on: 3.1) (complexity: standard) (gate: none)
- [ ] 8.2 Calendar day-type rule: configured HTTPS feed only, private targets rejected, cached, manual fallback (depends on: 8.1) (complexity: judgment) (gate: none)
- [ ] 8.3 Slot budgets with rollover, next_slot operation and Home Assistant sensor (depends on: 8.1, 7.2) (complexity: standard) (gate: none)
- [ ] 8.4 Planned items: plan_slot for agents, one shared meal action by item id, revision and mutation id, planned-item buttons in Home Assistant (depends on: 8.3, 7.3) (complexity: standard) (gate: none)
- [ ] 8.5 PWA slot view with budgets, planned items and meal actions (depends on: 8.4, 2.5) (complexity: standard) (gate: none)
- [ ] 8.6 Suggested slot shares from slot-labelled history (depends on: 8.4) (complexity: standard) (gate: none)
