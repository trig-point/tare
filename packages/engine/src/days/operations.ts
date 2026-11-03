import { z as zod } from "zod";
import { localDay } from "../logging/day.ts";
import { defineOperation, operationPerson } from "../operations/registry.ts";
import { readTarget, targetSchema } from "../target/reader.ts";
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
    output: ledgerSchema.extend({
      target: targetSchema,
      remaining: zod.strictObject({
        kcal: zod.number().nullable(),
        protein_g: zod.number().nullable(),
      }),
    }),
    handler(_input, context) {
      const person = operationPerson(context);
      const now = context.clock.now();
      const day = localDay(
        now.toISOString(),
        person.timezone,
        person.day_start_hour,
      );
      const ledger = readLedger(context.database, person.id, day);
      const target = readTarget(
        context.database,
        person,
        now,
        context.config.tdee,
      );
      const remaining = (key: "kcal" | "protein_g") => {
        const total = ledger.totals[key];
        return target.status === "ready" &&
          total.complete &&
          total.total !== null
          ? target[key] - total.total
          : null;
      };
      return {
        status: 200,
        body: {
          ...ledger,
          target,
          remaining: {
            kcal: remaining("kcal"),
            protein_g: remaining("protein_g"),
          },
        },
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
