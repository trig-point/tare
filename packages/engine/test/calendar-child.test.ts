import assert from "node:assert/strict";
import type { fork } from "node:child_process";
import { EventEmitter } from "node:events";
import { createCalendarEvaluator } from "../src/calendar/index.ts";
import { fixture } from "./auth-support.ts";
import { HANG_CEILING_MS, test } from "./support/hang-ceiling.ts";

const input = {
  feed_text:
    "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:sample\nDTSTART:20270105T090000Z\nDURATION:PT1H\nSUMMARY:Office\nEND:VEVENT\nEND:VCALENDAR",
  timezone: "UTC",
  day_start_hour: 4,
  day: "2027-01-05",
  keywords: ["office"],
};
class FakeChild extends EventEmitter {
  pid: number | undefined = 123;
  killed = false;
  send(_input: unknown, callback: (error: Error | null) => void) {
    callback(null);
  }
  kill(signal: string) {
    assert.equal(signal, "SIGKILL");
    this.killed = true;
    return true;
  }
}
function fakeFork(children: FakeChild[]): typeof fork {
  return ((
    _entry: URL,
    _args: string[],
    options: { env: NodeJS.ProcessEnv; execArgv: string[]; stdio: string[] },
  ) => {
    assert.deepEqual(options.env, { TZ: "UTC" });
    assert.deepEqual(options.stdio, ["ignore", "ignore", "ignore", "ipc"]);
    assert.deepEqual(options.execArgv, ["--max-old-space-size=128"]);
    const child = new FakeChild();
    children.push(child);
    return child;
  }) as unknown as typeof fork;
}

test("real child runs TypeScript directly and returns only a decision", async () => {
  const evaluator = createCalendarEvaluator({ deadlineMs: HANG_CEILING_MS });
  try {
    assert.deepEqual(await evaluator.evaluate(input), {
      status: "match",
      rule_index: 0,
    });
    assert.deepEqual(
      await evaluator.evaluate({ ...input, keywords: ["absent"] }),
      { status: "no_match" },
    );
  } finally {
    await evaluator.close();
  }
  assert.deepEqual(await evaluator.evaluate(input), { status: "unavailable" });
});

test("first IPC decision wins and the slot waits for actual exit", async (context) => {
  const children: FakeChild[] = [];
  const evaluator = createCalendarEvaluator({
    concurrency: 1,
    forkProcess: fakeFork(children),
  });
  const first = evaluator.evaluate(input);
  const second = evaluator.evaluate(input);
  let firstSettled = false;
  void first.then(() => {
    firstSettled = true;
  });
  const child = children[0];
  assert(child);
  const { app } = fixture(context);
  assert.deepEqual(await (await app.request("/health")).json(), {
    status: "ok",
  });
  assert.equal(firstSettled, false);
  child.emit("message", { status: "match", rule_index: 0 });
  child.emit("message", { status: "no_match" });
  assert(child.killed);
  assert.equal(children.length, 1);
  child.emit("exit", null, "SIGKILL");
  assert.equal(children.length, 2);
  children[1]?.emit("message", { status: "no_match" });
  children[1]?.emit("exit", null, "SIGKILL");
  assert.deepEqual(await first, { status: "match", rule_index: 0 });
  assert.deepEqual(await second, { status: "no_match" });
  await evaluator.close();
});

test("malformed IPC is unavailable", async () => {
  const children: FakeChild[] = [];
  const evaluator = createCalendarEvaluator({
    forkProcess: fakeFork(children),
  });
  const result = evaluator.evaluate(input);
  children[0]?.emit("message", { status: "match", rule_index: 1 });
  children[0]?.emit("exit", null, "SIGKILL");
  assert.deepEqual(await result, { status: "unavailable" });
  await evaluator.close();
});

test("stepped deadline kills the child and close drains active and queued work", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const children: FakeChild[] = [];
  const evaluator = createCalendarEvaluator({
    concurrency: 1,
    forkProcess: fakeFork(children),
  });
  const timed = evaluator.evaluate(input);
  const queued = evaluator.evaluate(input);
  context.mock.timers.tick(1999);
  assert.equal(children[0]?.killed, false);
  context.mock.timers.tick(1);
  assert.equal(children[0]?.killed, true);
  assert.equal(children.length, 1);
  children[0]?.emit("exit", null, "SIGKILL");
  assert.deepEqual(await timed, { status: "unavailable" });
  const third = evaluator.evaluate(input);
  const closing = evaluator.close();
  assert.equal(children[1]?.killed, true);
  children[1]?.emit("exit", null, "SIGKILL");
  await closing;
  assert.equal(children.length, 2);
  assert.deepEqual(await queued, { status: "unavailable" });
  assert.deepEqual(await third, { status: "unavailable" });
  context.mock.timers.reset();
});
