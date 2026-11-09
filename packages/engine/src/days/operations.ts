import { z as zod } from "zod";
import { localDay } from "../logging/day.ts";
import { weightRow } from "../logging/schemas.ts";
import { defineOperation, operationPerson } from "../operations/registry.ts";
import { selectTargetNotice } from "../queries/select-target-notice.ts";
import { selectTodayWeights } from "../queries/select-today-weights.ts";
import { targetNoticeSchema } from "../target/operations.ts";
import { readTarget, targetSchema } from "../target/reader.ts";
import { findFood, findFoodInput, findFoodOutput } from "./find-food.ts";
import { ledgerSchema, readLedger, remainingFor } from "./ledger.ts";

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
      weights: zod.array(weightRow),
      timezone: zod.string(),
      target: targetSchema,
      target_notice: targetNoticeSchema,
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
      const target = readTarget(context.database, person, now, context.config);
      return {
        status: 200,
        body: {
          ...ledger,
          timezone: person.timezone,
          weights: selectTodayWeights(context.database, {
            user_id: person.id,
            day,
          }),
          target,
          target_notice: selectTargetNotice(context.database, {
            user_id: person.id,
          }),
          remaining: {
            kcal: remainingFor(target, ledger.totals, "kcal"),
            protein_g: remainingFor(target, ledger.totals, "protein_g"),
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
