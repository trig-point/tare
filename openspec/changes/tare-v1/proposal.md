## Why

Tare exists to close the loop between what a person eats and what their weight does: log intake and weigh-ins, learn their real daily energy use (TDEE) from the trend, and turn that into a daily target and a plan for the day's meals. Today the repository holds only the engine scaffold. This change specifies everything version 1 needs, so each piece can be built as one pull request in a known order.

## What Changes

- Accounts for several people on one install: password login, per-user agent tokens, and every personal row scoped to its owner.
- One definition per operation (log food, log weight, today, find food, and the rest), served as HTTP routes and as an MCP server so AI agents can log on a person's behalf.
- A web app installed as a PWA: today view, food search, barcode scanning, day sign-off, and an offline queue that never drops an entry.
- A nutrition source chain that only accepts exact matches: the person's own foods and a shared cache automatically, USDA FoodData Central and Open Food Facts when the person asks, and a question when an order's meal is unknown. Every value records where it came from, and callers cannot claim lab-verified numbers.
- Meal-kit orders: a forwarded order email is parsed into an order for a delivery date, merged with the other email for the same delivery, and turned into meals on hand. Unknown meals become nutrition questions that a person or an agent answers once.
- A daily target: a formula from the person's profile first, then an adaptive TDEE estimate learned from signed-off days and the weight trend.
- Health signals (steps, sleep, heart rate and similar) from manual entry, agents and Oura, shown beside intake; version 1 does not feed them into the target.
- Home Assistant integration over MQTT: per-person sensors, panel buttons that act on a specific item, and weigh-ins from a Bluetooth scale.
- A meal plan: day templates of slots with a share of the day's budget each, day types, leftover budget shared across the day's open slots, and planned items that agents place.
- Operations: a container image, a job runner for scheduled work, nightly backups with a tested restore, a safe table-rebuild path for migrations, and a CI check that keeps personal paths and hostnames out of source.

## Capabilities

### New Capabilities

- `accounts-and-access`: users, sessions, agent tokens, tenant isolation, adding a second user.
- `agent-interface`: the operation registry, HTTP routes, the MCP server, and the provenance argument on writes.
- `offline-pwa`: the installable app shell, the offline write queue, and its sign-in-needed state.
- `deployment-and-backup`: container image, backups and restore, migration safety, and the repository hygiene check.
- `food-logging`: logging operations, today view, food entry, barcode scanning, day sign-off, regular meals, and the one-time importer.
- `nutrition-sources`: the exact-match resolver and the USDA FoodData Central and Open Food Facts adapters.
- `meal-kit-orders`: the questions queue, orders and meals on hand, the order-email parser, the inbound endpoint, order reconciliation, and new-meal nutrition questions.
- `daily-target`: profile, formula target, weight trend, adaptive TDEE and weekly recompute.
- `health-signals`: the daily signals store, manual and agent entry, and the Oura adapter.
- `home-assistant`: MQTT discovery sensors, item buttons, scale weigh-ins, and notices.
- `meal-plan`: day templates, slots, day types, slot budgets, planned items and suggested budgets.

### Modified Capabilities

None. No specs exist yet.

## Impact

- `packages/engine`: new migrations, queries, operations, routes, MCP server and jobs.
- New packages: `packages/nutrition`, `packages/order-parser`, `packages/health-sources`, and `apps/web` (the PWA).
- New runtime dependencies, each named by the task that adds it: zod and @hono/zod-validator, @hono/mcp, croner, rate-limiter-flexible, mailauth, mailparser, the openai SDK, oauth4webapi, async-mutex, request-filtering-agent, node-ical and mqtt (mqtt.js) in the engine; vite-plugin-pwa (Workbox), TanStack Router and TanStack Query, idb, barcode-detector and uPlot in the PWA.
- External services, each optional and configured by the operator: an OpenAI-compatible model endpoint, USDA FoodData Central (API key), Open Food Facts (no key, rate limited), Oura (an OAuth app per install), and an MQTT broker.
- Out of this repository: agent skills that use the MCP interface (meal-kit picking and nutrition answering) live in the operator's own agent configuration and are tracked separately.
- Post version 1, not specified here: a pantry (Grocy) and a pantry-aware meal solver, a CLI, a HACS package, more health sources, paid nutrition providers, and image-based logging.
