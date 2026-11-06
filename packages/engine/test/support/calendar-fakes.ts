import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import type { Database } from "better-sqlite3";
import type {
  CalendarInput,
  CalendarResult,
} from "../../src/calendar/index.ts";
import { createCalendarRefresher } from "../../src/calendar/refresh.ts";

export const until = async (condition: () => boolean) => {
  while (!condition()) await setImmediate();
};

export function calendarFakes(
  context: TestContext,
  database: Database,
  clock: { now(): Date },
) {
  const calls: {
    url: string;
    signal: AbortSignal;
    resolve(value: string | null): void;
    reject(error: Error): void;
  }[] = [];
  let evaluate: (input: CalendarInput) => Promise<CalendarResult> =
    async () => ({ status: "match", rule_index: 0 });
  let closed = false;
  const calendar = createCalendarRefresher({
    database,
    clock,
    evaluator: {
      evaluate: (input) => evaluate(input),
      close: async () => {
        closed = true;
      },
    },
    transport: (url, signal) => {
      assert.equal(database.inTransaction, false);
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => resolve(null), { once: true });
        calls.push({ url, signal, resolve, reject });
      });
    },
  });
  context.after(() => calendar.stop());
  return {
    calendar,
    calls,
    closed: () => closed,
    useEvaluator(value: typeof evaluate) {
      evaluate = value;
    },
  };
}
