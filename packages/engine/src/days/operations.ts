import { z as zod } from "zod";
import { localDay } from "../logging/day.ts";
import { weightRow } from "../logging/schemas.ts";
import { doseSchema, readDayDoses } from "../medications/read.ts";
import { defineOperation, operationPerson } from "../operations/registry.ts";
import { searchOwnFoods } from "../queries/search-own-foods.ts";
import { searchSourceFoods } from "../queries/search-source-foods.ts";
import { selectTargetNotice } from "../queries/select-target-notice.ts";
import { selectTodayWeights } from "../queries/select-today-weights.ts";
import { targetNoticeSchema } from "../target/operations.ts";
import { readTarget, targetSchema } from "../target/reader.ts";
import { findFood, findFoodInput, findFoodOutput } from "./find-food.ts";
import { ledgerSchema, readLedgerView, remainingFor } from "./ledger.ts";
import { listUsualFoods, usualFoodsOutput } from "./usual-foods.ts";

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
      doses: zod.array(doseSchema),
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
      const ledger = readLedgerView(context.database, person.id, day);
      const target = readTarget(context.database, person, now, context.config);
      return {
        status: 200,
        body: {
          ...ledger,
          doses: readDayDoses(context.database, person, day, now.toISOString()),
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
  defineOperation({
    ...shared,
    name: "list_usual_foods",
    description:
      "List the foods you logged most in the last 30 days, with the servings you usually log.",
    method: "GET",
    path: "/api/foods/usual",
    input: zod.strictObject({}),
    output: usualFoodsOutput,
    handler(_input, context) {
      const person = operationPerson(context);
      const day = localDay(
        context.clock.now().toISOString(),
        person.timezone,
        person.day_start_hour,
      );
      return {
        status: 200,
        body: listUsualFoods(context.database, person.id, day),
      };
    },
  }),
  defineOperation({
    ...shared,
    name: "search_foods",
    callerClass: "browser",
    method: "POST",
    path: "/api/foods/search",
    bodyLimit: 1024,
    input: zod.strictObject({ name: zod.string().trim().min(1).max(200) }),
    output: zod.strictObject({
      foods: zod.array(
        zod.strictObject({
          reference: zod.strictObject({
            kind: zod.enum(["food", "source_food"]),
            id: zod.number().int().positive(),
          }),
          source: zod.enum(["usda", "off"]).nullable(),
          name: zod.string(),
          brand: zod.string().nullable(),
          serving: zod.string().nullable(),
        }),
      ),
    }),
    handler(input, context) {
      const pattern = input.name.replace(/[!%_]/g, "!$&");
      const serving = (size: number | null, unit: string | null) =>
        size === null ? null : `${size} ${unit ?? ""}`.trim();
      const own = searchOwnFoods(context.database, {
        user_id: operationPerson(context).id,
        pattern,
      }).map((food) => ({
        reference: { kind: "food" as const, id: food.id },
        source: null,
        name: food.name,
        brand: null,
        serving: serving(food.serving_size, food.serving_unit),
      }));
      const cached = searchSourceFoods(context.database, { pattern }).map(
        (food) => ({
          reference: { kind: "source_food" as const, id: food.id },
          source: food.source,
          name: food.name,
          brand: food.brand,
          serving: serving(food.serving_size, food.serving_unit),
        }),
      );
      return { status: 200, body: { foods: [...own, ...cached] } };
    },
  }),
];
