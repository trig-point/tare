import { z as zod } from "zod";

const day = zod.iso.date();
const instant = zod.iso.datetime({ offset: true });
const count = zod.number().nonnegative();

export const dailyActivity = zod.object({
  day,
  steps: count.nullable().optional(),
  active_calories: count.nullable().optional(),
});
export const sleepPeriod = zod.object({
  id: zod.string().min(1),
  day,
  type: zod.string().min(1),
  bedtime_start: instant,
  bedtime_end: instant,
  total_sleep_duration: count.nullable().optional(),
  lowest_heart_rate: count.nullable().optional(),
  average_hrv: count.nullable().optional(),
});
export const dailyReadiness = zod.object({
  day,
  score: count.nullable().optional(),
});
export const workout = zod.object({
  id: zod.string().min(1),
  day,
  activity: zod.string().min(1),
  calories: count.nullable().optional(),
  start_datetime: instant,
  end_datetime: instant,
});
export const page = <Item extends zod.ZodType>(item: Item) =>
  zod.object({
    data: zod.array(item),
    next_token: zod.string().nullable().optional(),
  });
