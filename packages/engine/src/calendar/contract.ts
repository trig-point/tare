import * as schema from "zod";

export function validCalendarKeyword(keyword: string): boolean {
  return /^[\p{L}\p{N}_]{1,40}$/u.test(keyword);
}

export const calendarInput = schema.strictObject({
  feed_text: schema.string().max(1_000_000),
  timezone: schema.string().min(1),
  day_start_hour: schema.number().int().min(0).max(23),
  day: schema.iso.date(),
  keywords: schema.array(schema.string().refine(validCalendarKeyword)),
});
export type CalendarInput = schema.infer<typeof calendarInput>;
export const calendarResult = schema.discriminatedUnion("status", [
  schema.strictObject({
    status: schema.literal("match"),
    rule_index: schema.number().int().min(0),
  }),
  schema.strictObject({ status: schema.literal("no_match") }),
  schema.strictObject({ status: schema.literal("unavailable") }),
]);
export type CalendarResult = schema.infer<typeof calendarResult>;
