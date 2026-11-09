import { z as zod } from "zod";
import { emptyInput } from "../auth/routes.ts";
import { localDay } from "../logging/day.ts";
import { defineOperation, operationPerson } from "../operations/registry.ts";
import { selectWeightHistory } from "../queries/select-weight-history.ts";
import { readWorkouts } from "../signals/activities.ts";
import { type BodyFatReading, bodyFatTrend, shiftDay } from "./body-fat.ts";
import { weightTrend } from "./weight-trend.ts";

const weightTrendDayOutput = zod.strictObject({
  day: zod.iso.date(),
  reading_kg: zod.number().nullable(),
  trend_kg: zod.number(),
});

export const weightHistory = defineOperation({
  name: "weight_history",
  method: "GET",
  path: "/api/weights/history",
  modes: ["access", "fallback"],
  callerClass: "browser_and_agent",
  admin: false,
  input: emptyInput,
  output: zod.strictObject({ days: zod.array(weightTrendDayOutput) }),
  handler: (_input, context) => ({
    status: 200,
    body: {
      days: weightTrend(
        selectWeightHistory(context.database, {
          user_id: operationPerson(context).id,
        }),
      ),
    },
  }),
});

const bodyFatReadingOutput = zod.strictObject({
  id: zod.number(),
  day: zod.iso.date(),
  measured_at: zod.string(),
  body_fat_pct: zod.number(),
  after_workout: zod.boolean(),
  in_trend: zod.boolean(),
});
const bodyFatTrendOutput = zod.discriminatedUnion("status", [
  zod.strictObject({
    status: zod.literal("not_enough"),
    current_count: zod.number(),
    prior_count: zod.number(),
    lines: zod.array(zod.string()),
  }),
  zod.strictObject({
    status: zod.literal("ready"),
    level_pct: zod.number(),
    change_points: zod.number(),
    lines: zod.array(zod.string()),
  }),
]);

export const bodyFatHistory = defineOperation({
  name: "body_fat_history",
  method: "GET",
  path: "/api/body-fat/history",
  modes: ["access", "fallback"],
  callerClass: "browser_and_agent",
  admin: false,
  input: emptyInput,
  output: zod.strictObject({
    readings: zod.array(bodyFatReadingOutput),
    trend: bodyFatTrendOutput.nullable(),
  }),
  handler: (_input, context) => {
    const person = operationPerson(context);
    const today = localDay(
      context.clock.now().toISOString(),
      person.timezone,
      person.day_start_hour,
    );
    const weights = selectWeightHistory(context.database, {
      user_id: person.id,
    });
    const readings: BodyFatReading[] = weights.flatMap(
      ({ id, day, measured_at, body_fat_pct }) =>
        body_fat_pct === null ? [] : [{ id, day, measured_at, body_fat_pct }],
    );
    const first = readings[0]?.day ?? today;
    const strengthFrom = shiftDay(today, -20);
    const workouts = readWorkouts(context.database, {
      user_id: person.id,
      from: shiftDay(first < strengthFrom ? first : strengthFrom, -1),
      to: today,
    });
    return {
      status: 200,
      body: bodyFatTrend({
        readings,
        workouts,
        weights: weightTrend(weights),
        today,
      }),
    };
  },
});

export const trendOperations = [weightHistory, bodyFatHistory];
