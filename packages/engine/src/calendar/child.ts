import { evaluateCalendar } from "./evaluate.ts";

process.once("message", (input: unknown) => {
  process.send?.(evaluateCalendar(input));
});
