import { z as zod } from "zod";
import { writeTransaction } from "../db.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { deleteCalendarCache } from "../queries/calendar/delete-calendar-cache.ts";
import { deleteCalendarRules } from "../queries/calendar/delete-calendar-rules.ts";
import { insertCalendarRule } from "../queries/calendar/insert-calendar-rule.ts";
import { saveCalendarSettings } from "../queries/calendar/save-calendar-settings.ts";
import { selectCalendarSettings } from "../queries/calendar/select-calendar-settings.ts";
import { selectDayType } from "../queries/select-day-type.ts";
import { validCalendarKeyword } from "./contract.ts";
import { readCalendarSettings, validFeedUrl } from "./settings.ts";

const rule = zod.strictObject({
  keyword: zod.string(),
  day_type_id: zod.number().int().positive(),
});
const output = zod.strictObject({
  configured: zod.boolean(),
  rules: zod.array(rule),
  status: zod.enum([
    "not_configured",
    "pending",
    "match",
    "no_match",
    "unavailable",
  ]),
  checked_at: zod.string().optional(),
  day_type_id: zod.number().int().positive().optional(),
});
const shared = {
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser",
  admin: false,
  path: "/api/calendar/settings",
  output,
} as const;
export const calendarOperations = [
  defineOperation({
    ...shared,
    name: "read_calendar_settings",
    method: "GET",
    input: zod.strictObject({}),
    handler(_input, context) {
      return {
        status: 200,
        body: readCalendarSettings(
          context.database,
          operationPerson(context),
          context.clock.now(),
        ),
      };
    },
  }),
  defineOperation({
    ...shared,
    name: "save_calendar_settings",
    method: "POST",
    bodyLimit: 16384,
    input: zod.strictObject({
      enabled: zod.boolean(),
      feed_url: zod.string().max(2048).optional(),
      rules: zod.array(rule).max(20),
    }),
    handler(input, context) {
      const person = operationPerson(context);
      const key = { user_id: person.id };
      writeTransaction(context.database, () => {
        const url =
          input.feed_url ??
          selectCalendarSettings(context.database, key)?.feed_url;
        if (input.feed_url !== undefined && !validFeedUrl(input.feed_url))
          throw new OperationError(400, "invalid_feed_url");
        if (input.enabled && !url)
          throw new OperationError(400, "invalid_feed_url");
        for (const item of input.rules) {
          if (!validCalendarKeyword(item.keyword))
            throw new OperationError(400, "invalid_keyword");
          if (
            !selectDayType(context.database, { ...key, id: item.day_type_id })
          )
            throw new OperationError(404, "not_found");
        }
        saveCalendarSettings(context.database, {
          ...key,
          feed_url: input.enabled ? (url as string) : null,
          enabled: Number(input.enabled),
          now: context.clock.now().toISOString(),
        });
        deleteCalendarRules(context.database, key);
        deleteCalendarCache(context.database, key);
        if (input.enabled)
          input.rules.forEach((item, position) =>
            insertCalendarRule(context.database, { ...key, ...item, position }),
          );
      });
      context.calendar?.enqueue(person.id);
      return {
        status: 200,
        body: readCalendarSettings(
          context.database,
          person,
          context.clock.now(),
        ),
      };
    },
  }),
];
