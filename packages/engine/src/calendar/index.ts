import { type ChildProcess, fork } from "node:child_process";
import {
  type CalendarInput,
  type CalendarResult,
  calendarInput,
  calendarResult,
} from "./contract.ts";

export {
  type CalendarInput,
  type CalendarResult,
  validCalendarKeyword,
} from "./contract.ts";
export { personDayBounds } from "./time.ts";

type Task = { input: CalendarInput; resolve: (result: CalendarResult) => void };
export function createCalendarEvaluator({
  deadlineMs = 2000,
  heapMb = 128,
  concurrency = 2,
  forkProcess = fork,
}: {
  deadlineMs?: number;
  heapMb?: number;
  concurrency?: number;
  forkProcess?: typeof fork;
} = {}) {
  if (
    ![deadlineMs, heapMb, concurrency].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    throw new Error("invalid_evaluator_limits");
  const queue: Task[] = [];
  const running = new Map<ChildProcess, () => void>();
  const pending = new Set<Promise<CalendarResult>>();
  let closed = false;

  function drain() {
    while (!closed && running.size < concurrency && queue.length) {
      const task = queue.shift();
      if (!task) break;
      let child: ChildProcess;
      try {
        child = forkProcess(new URL("./child.ts", import.meta.url), [], {
          env: { ...process.env, TZ: "UTC" },
          execArgv: [`--max-old-space-size=${heapMb}`],
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
      } catch {
        task.resolve({ status: "unavailable" });
        continue;
      }
      let result: CalendarResult = { status: "unavailable" };
      let stopped = false;
      let finished = false;
      const timer = setTimeout(() => fail(), deadlineMs);
      function finish() {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        running.delete(child);
        task?.resolve(result);
        drain();
      }
      function stop() {
        if (stopped) return;
        stopped = true;
        if (child.pid === undefined) finish();
        else child.kill("SIGKILL");
      }
      function fail() {
        if (stopped) return;
        result = { status: "unavailable" };
        stop();
      }
      running.set(child, () => {
        result = { status: "unavailable" };
        stop();
      });
      child.once("message", (message: unknown) => {
        if (stopped) return;
        const response = calendarResult.safeParse(message);
        if (
          response.success &&
          (response.data.status !== "match" ||
            response.data.rule_index < task.input.keywords.length)
        )
          result = response.data;
        stop();
      });
      child.once("error", () => fail());
      child.once("exit", () => finish());
      child.once("disconnect", () => fail());
      try {
        child.send(task.input, (error) => {
          if (error) fail();
        });
      } catch {
        fail();
      }
    }
  }

  return {
    evaluate(input: CalendarInput): Promise<CalendarResult> {
      const parsed = calendarInput.safeParse(input);
      if (
        closed ||
        !parsed.success ||
        Buffer.byteLength(parsed.data.feed_text) > 1_000_000
      )
        return Promise.resolve({ status: "unavailable" });
      const promise = new Promise<CalendarResult>((resolve) => {
        queue.push({ input: parsed.data, resolve });
        drain();
      });
      pending.add(promise);
      void promise.then(() => pending.delete(promise));
      return promise;
    },
    async close(): Promise<void> {
      closed = true;
      for (const task of queue.splice(0))
        task.resolve({ status: "unavailable" });
      for (const stop of running.values()) stop();
      await Promise.all(pending);
    },
  };
}
