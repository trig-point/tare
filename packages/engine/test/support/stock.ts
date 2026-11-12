import { createPantryStock } from "../../src/pantry/requests.ts";

/** Stock for an install without Grocy: references record the disabled reason. */
export const disabledStock = createPantryStock({
  config: null,
  ownerId: null,
  clock: { now: () => new Date() },
  report: () => {},
});
