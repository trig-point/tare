## Why

Restaurant meals and home-cooked plates have no barcode, so today they are logged as one hand-typed guess. The guess is usually wrong in the amount, not in what the food is: on a takeout lunch the rice portion alone can move the total by about 200 kcal. Weighing or photographing the parts and letting Tare do the math from per-gram values gives a better number and an honest range.

## What Changes

- Agents can search USDA FoodData Central for candidate foods by name and add the one they pick by its FDC id to the shared source cache. The exact-match rule for automatic lookups is unchanged; this is an explicit pick.
- A referenced food can be logged with an estimated amount: the per-gram values keep the food's source, the entry stores that its amount is estimated, is marked `estimated`, and may carry a range from a low and high amount. Editing the amount recomputes the range from the food, and marking the amount as measured restores the food's own provenance. An estimated amount never consumes pantry stock.
- A new `log_meal_parts` operation logs a meal from its parts in grams (for example rice 300 g, chicken 170 g), each part with an optional gram range, as one entry per part written in one transaction with a stored meal receipt, so a retry is safe.
- A photo estimate route sends one photo to a configured vision model and returns proposed parts with names and gram ranges. It never logs and never stores the photo. The model is chosen by a research spike before the route is built.
- The PWA's add-food screen gains a Photo tab: take a photo, review and correct the proposed parts and grams, pick a food for each part, and log the meal.

Not in this change: showing ranges in the ledger, sizing portions from depth sensors, calibrating estimates against the weight trend, and storing photos.

## Capabilities

### New Capabilities
- `meal-parts-logging`: logging a meal from parts in grams, the photo estimate route, and the Photo tab.

### Modified Capabilities
- `food-logging`: a referenced food may be logged with an estimated amount and a range.
- `nutrition-sources`: an explicit candidate search for agents and adding a USDA food to the source cache by its FDC id.

## Impact

- Engine: the intake writer and provenance rule (`packages/engine/src/logging/`), `edit_intake`, new lookup operations over the existing USDA adapter (`packages/engine/src/sources/usda.ts`, `fetchById` gets its first caller), the operation registry, the pantry egress list, the MCP error passthrough, a new photo route with its own body limit, and new configuration keys for the vision provider.
- Nutrition package: `servingsFor` in `packages/nutrition/src/units.ts` gets its first engine caller.
- Web: a Photo tab in `apps/web/src/add-food.tsx` and an online-only client call.
- Two additive migrations: estimated-amount columns on the intake table, and meal receipt tables.
- Depends on the `tare-v1` change's logging operations, nutrition sources and agent interface; the delta specs apply after `tare-v1` is archived.
