## Why

Tare can log food and track delivered meals, but cannot tell an agent which groceries are available. Pantry inventory moves into V1 so the agent can suggest meals from food on hand and the person can confirm what they ate.

## What Changes

- Run Grocy as a separate container alongside the reference Tare deployment. Grocy owns grocery stock and barcode intake through its existing interface and Open Food Facts lookup plugin.
- Read Grocy stock into a user-scoped Tare snapshot with quantities, units, expiry information and freshness. Preserve units when no verified grams conversion exists.
- Bind a Tare food explicitly to a Grocy product and stock quantity per serving. Eating a bound food schedules consumption once; an unmatched food still logs and reports that stock did not change.
- Keep delivered meal inventory in Tare. Eating an order meal changes only its existing Tare inventory, including when its nutrition food also has a grocery binding.
- Add pantry-based suggestions as the second step in this change, after the stock and consumption path. Reuse Grocy recipe fulfillment and Tare's existing day plan, nutrition and agent operations.
- Leave shopping-list writes and a numerical meal-plan solver after V1. The existing Tare barcode scanner remains a food-logging tool.

## Capabilities

### New Capabilities

- `pantry-inventory`: Grocy deployment contract, stock reads, explicit food bindings, consumption delivery and visible reconciliation.
- `pantry-suggestions`: pantry and recipe context for agents, deterministic availability and nutrition checks, and confirmation through existing planning and eating operations.

### Modified Capabilities

None in `openspec/specs/`, which has no published capabilities yet. This change extends the active `tare-v1` change; its pantry deferral and planned-food stock exception are updated alongside it.

## Impact

- Engine: optional Grocy configuration, migrations and TypeSQL queries, stock refresh job, operation registry entries, durable consumption requests and existing intake callers.
- Web: stock freshness, binding and reconciliation controls, plus a link to Grocy for stocking. No new barcode intake screen.
- Deployment: generic Compose example and backup/restore instructions for a maintained Grocy image, with private configuration supplied at install time.
- Dependencies: build on Node fetch, Zod, better-sqlite3, TypeSQL, the existing job runner and TanStack Query. No ORM or solver dependency.
- Tracker: reuse the existing Grocy tickets; new tickets cover only missing bindings, reliable consumption, caller integration and suggestion context. All implementation tasks belong to V1 Meal plan.
