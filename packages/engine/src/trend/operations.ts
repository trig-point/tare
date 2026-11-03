import { z as zod } from "zod";
import { emptyInput } from "../auth/routes.ts";
import { defineOperation, operationPerson } from "../operations/registry.ts";
import { selectWeightHistory } from "../queries/select-weight-history.ts";
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
