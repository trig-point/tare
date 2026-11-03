import { z as zod } from "zod";
import { localDay } from "../logging/day.ts";
import { defineOperation, operationPerson } from "../operations/registry.ts";
import { findFood, findFoodInput, findFoodOutput } from "./find-food.ts";
import { ledgerSchema, readLedger } from "./ledger.ts";

const shared = {
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser_and_agent",
  admin: false,
} as const;
export const dayReadOperations = [
  defineOperation({
    ...shared,
    name: "today",
    method: "GET",
    path: "/api/today",
    input: zod.strictObject({}),
    output: ledgerSchema,
    handler(_input, context) {
      const person = operationPerson(context);
      const day = localDay(
        context.clock.now().toISOString(),
        person.timezone,
        person.day_start_hour,
      );
      return {
        status: 200,
        body: readLedger(context.database, person.id, day),
      };
    },
  }),
  defineOperation({
    ...shared,
    name: "find_food",
    method: "POST",
    path: "/api/foods/find",
    bodyLimit: 8192,
    input: findFoodInput,
    output: findFoodOutput,
    handler(input, context) {
      return {
        status: 200,
        body: findFood(context.database, operationPerson(context).id, input),
      };
    },
  }),
];
