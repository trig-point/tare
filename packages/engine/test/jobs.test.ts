import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { scheduledJobs } from "croner";
import { openDatabase } from "../src/db.ts";
import { createJobRunner } from "../src/jobs.ts";
import type { RecordFinishResult } from "../src/queries/jobs/record-finish.ts";
import { recordStart } from "../src/queries/jobs/record-start.ts";

function deferred<Value = string>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function setup(context: TestContext, timezone = "UTC") {
  context.mock.timers.enable({
    apis: ["Date", "setTimeout"],
    now: new Date("2026-03-08T00:00:00Z"),
  });
  const directory = mkdtempSync(join(tmpdir(), "tare-jobs-"));
  const connection = openDatabase(join(directory, "test.sqlite"));
  const reports: [string, string][] = [];
  const clock = { now: () => new Date() };
  const reporter = {
    report: (code: string, name: string) => {
      reports.push([code, name]);
    },
  };
  const runner = createJobRunner({
    database: connection.database,
    timezone,
    clock,
    report: (...args) => reporter.report(...args),
  });
  context.after(async () => {
    held.resolve("finished");
    await runner.stop();
    if (connection.database.open) connection.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const read = (name = "daily") =>
    connection.database
      .prepare<[string], RecordFinishResult>(
        "SELECT * FROM job_runs WHERE job_name = ?",
      )
      .get(name);
  const cron = (name = "daily") => {
    const timer = scheduledJobs.find((timer) => timer.name === name);
    assert.ok(timer);
    return timer;
  };
  const held = deferred();
  const entered = deferred<void>();
  let calls = 0;
  const job = {
    name: "daily",
    schedule: "* * * * * *",
    run: (_options: { signal: AbortSignal }) => {
      calls++;
      entered.resolve();
      return held.promise;
    },
  };
  const start = () => {
    runner.register(job);
    runner.start();
  };
  const fire = async () => {
    context.mock.timers.tick(1000);
    await entered.promise;
  };
  const skipTick = () => {
    context.mock.timers.tick(1000);
    context.mock.timers.tick(1);
  };
  const fail = (pattern: RegExp) => {
    const original = connection.database.prepare.bind(connection.database);
    return context.mock.method(
      connection.database,
      "prepare",
      (sql: string) => {
        if (pattern.test(sql))
          throw new Error("private body or database details");
        return original(sql);
      },
    );
  };
  return {
    ...connection,
    runner,
    reports,
    clock,
    reporter,
    read,
    cron,
    held,
    entered,
    job,
    start,
    fire,
    skipTick,
    fail,
    calls: () => calls,
  };
}

test("row 4: croner protect records exactly one scheduled overlap", async (context) => {
  const fixture = setup(context);
  fixture.start();
  await fixture.fire();
  fixture.skipTick();
  assert.equal(fixture.calls(), 1);
  assert.equal(fixture.read()?.skipped_count, 1);
  assert.equal(fixture.read()?.status, "running");
});

test("two blocked scheduled firings count twice and finish preserves skips", async (context) => {
  const fixture = setup(context);
  fixture.start();
  await fixture.fire();
  fixture.skipTick();
  fixture.skipTick();
  const skippedAt = fixture.read()?.last_skipped_at;
  assert.equal(fixture.read()?.skipped_count, 2);
  fixture.held.resolve("saved");
  await fixture.runner.stop();
  assert.equal(fixture.read()?.status, "ok");
  assert.equal(fixture.read()?.detail, "saved");
  assert.equal(fixture.read()?.skipped_count, 2);
  assert.equal(fixture.read()?.last_skipped_at, skippedAt);
});

for (const broken of [false, true]) {
  test(`deferred protect after finish preserves result; write failure=${broken}`, async (context) => {
    const fixture = setup(context);
    fixture.start();
    await fixture.fire();
    const protect = deferred<() => void>();
    const originalSetTimeout = globalThis.setTimeout;
    context.mock.method(globalThis, "setTimeout", ((
      callback: () => void,
      delay?: number,
    ) => {
      if (delay === 0) {
        protect.resolve(callback);
        return originalSetTimeout(() => {}, delay);
      }
      return originalSetTimeout(callback, delay);
    }) as typeof setTimeout);
    context.mock.timers.tick(1000);
    const blocked = await protect.promise;
    fixture.held.resolve("saved");
    await setImmediate();
    assert.equal(fixture.read()?.status, "ok");
    if (broken) fixture.fail(/last_skipped_at =/);
    assert.doesNotThrow(blocked);
    assert.equal(fixture.read()?.status, "ok");
    assert.equal(fixture.read()?.detail, "saved");
    assert.equal(fixture.read()?.skipped_count, broken ? 0 : 1);
    assert.deepEqual(
      fixture.reports,
      broken ? [["record_write_failed", "daily"]] : [],
    );
  });
}

for (const [stage, pattern] of [
  ["start", /INSERT INTO job_runs/],
  ["finish", /SET finished_at/],
] as const) {
  for (const manual of [false, true]) {
    test(`rows 1,3,6,8: ${manual ? "manual" : "scheduled"} ${stage} write fails`, async (context) => {
      const fixture = setup(context);
      fixture.start();
      const failure = fixture.fail(pattern);
      fixture.held.resolve("saved");
      if (manual)
        await assert.rejects(fixture.runner.runNow("daily"), /private/);
      else await fixture.cron().trigger();
      assert.equal(fixture.calls(), stage === "start" ? 0 : 1);
      assert.equal(
        fixture.read()?.status,
        stage === "start" ? undefined : "running",
      );
      assert.deepEqual(
        fixture.reports,
        manual ? [] : [["record_write_failed", "daily"]],
      );
      failure.mock.restore();
      assert.equal((await fixture.runner.runNow("daily"))?.status, "ok");
    });
  }
}

for (const manual of [false, true]) {
  test(`rows 2,7: ${manual ? "manual" : "scheduled"} body failure is a redacted result`, async (context) => {
    const fixture = setup(context);
    fixture.job.run = () => {
      throw new Error("private body or database details");
    };
    fixture.start();
    if (manual)
      assert.equal((await fixture.runner.runNow("daily"))?.status, "failed");
    else await fixture.cron().trigger();
    assert.equal(fixture.read()?.status, "failed");
    assert.equal(fixture.read()?.detail, "job_failed");
    assert.deepEqual(fixture.reports, []);
  });
}

test("row 7: rejecting manual body resolves with the failed record", async (context) => {
  const fixture = setup(context);
  fixture.job.run = () => Promise.reject(new Error("private"));
  fixture.start();
  const result = await fixture.runner.runNow("daily");
  assert.ok(result && "detail" in result);
  assert.equal(result.detail, "job_failed");
});

for (const broken of [false, true]) {
  for (const entry of ["protect", "trigger", "manual", "scheduled"] as const) {
    test(`rows 4,5,5a,9: ${entry} skip write failure=${broken}`, async (context) => {
      const fixture = setup(context);
      fixture.start();
      const running =
        entry === "scheduled"
          ? fixture.runner.runNow("daily")
          : fixture.cron().trigger();
      await fixture.entered.promise;
      const failure = broken ? fixture.fail(/last_skipped_at =/) : undefined;
      if (entry === "manual") {
        if (broken)
          await assert.rejects(fixture.runner.runNow("daily"), /private/);
        else
          assert.deepEqual(await fixture.runner.runNow("daily"), {
            status: "skipped",
          });
      } else if (entry === "trigger") await fixture.cron().trigger();
      else fixture.skipTick();
      assert.equal(fixture.calls(), 1);
      assert.equal(fixture.read()?.status, "running");
      assert.equal(fixture.read()?.skipped_count, broken ? 0 : 1);
      assert.deepEqual(
        fixture.reports,
        broken && entry !== "manual" ? [["record_write_failed", "daily"]] : [],
      );
      failure?.mock.restore();
      fixture.held.resolve("saved");
      await running;
      assert.equal(fixture.read()?.status, "ok");
    });
  }
}

for (const second of ["scheduled", "manual"] as const) {
  test(`row 5a: manual guard survives a scheduled skip then a ${second} skip`, async (context) => {
    const fixture = setup(context);
    fixture.start();
    const running = fixture.runner.runNow("daily");
    await fixture.entered.promise;
    assert.equal(fixture.cron().isBusy(), false);
    fixture.skipTick();
    await setImmediate();
    if (second === "scheduled") fixture.skipTick();
    else
      assert.deepEqual(await fixture.runner.runNow("daily"), {
        status: "skipped",
      });
    assert.equal(fixture.calls(), 1);
    assert.equal(fixture.read()?.skipped_count, 2);
    fixture.held.resolve("saved");
    await running;
  });
}

test("row 9: scheduled guard survives two manual skips", async (context) => {
  const fixture = setup(context);
  fixture.start();
  const running = fixture.cron().trigger();
  await fixture.entered.promise;
  assert.deepEqual(await fixture.runner.runNow("daily"), { status: "skipped" });
  assert.deepEqual(await fixture.runner.runNow("daily"), { status: "skipped" });
  assert.equal(fixture.calls(), 1);
  assert.equal(fixture.read()?.skipped_count, 2);
  fixture.held.resolve("saved");
  await running;
});

test("zero-row skip and finish updates are record failures", async (context) => {
  const fixture = setup(context);
  fixture.start();
  const running = fixture.runner.runNow("daily");
  await fixture.entered.promise;
  fixture.database
    .prepare("DELETE FROM job_runs WHERE job_name = ?")
    .run("daily");
  await assert.rejects(fixture.runner.runNow("daily"), /Skip record missing/);
  fixture.held.resolve("saved");
  await assert.rejects(running, /Finish record missing/);
  assert.equal((await fixture.runner.runNow("daily"))?.status, "ok");
});

test("row 10: stale rows become interrupted without inventing a finish time", async (context) => {
  const fixture = setup(context);
  recordStart(fixture.database, {
    jobName: "stale",
    startedAt: "2026-03-07T03:00:00Z",
  });
  fixture.start();
  assert.equal(fixture.read("stale")?.status, "failed");
  assert.equal(fixture.read("stale")?.detail, "interrupted");
  assert.equal(fixture.read("stale")?.finished_at, null);
  assert.throws(() => fixture.runner.start(), /already started/);
});

test("row 10: stale write failure aborts start before any Cron exists", (context) => {
  const fixture = setup(context);
  fixture.runner.register(fixture.job);
  fixture.fail(/detail = 'interrupted'/);
  assert.throws(() => fixture.runner.start(), /private/);
  assert.equal(
    scheduledJobs.some((timer) => timer.name === "daily"),
    false,
  );
  assert.equal(fixture.calls(), 0);
});

test("row 11: an unowned handler error reaches croner catch without escaping", async (context) => {
  const fixture = setup(context);
  fixture.start();
  Object.defineProperty(fixture.job, "name", {
    get() {
      throw new Error("unexpected handler failure");
    },
  });
  await assert.doesNotReject(fixture.cron().trigger());
  assert.deepEqual(fixture.reports, [["job_unhandled", "daily"]]);
  assert.equal(fixture.read(), undefined);
});

for (const failure of ["none", "body", "finish"] as const) {
  test(`row 12: stop waits for the aborted body's finish attempt; failure=${failure}`, async (context) => {
    const fixture = setup(context);
    const aborted = deferred<void>();
    fixture.job.run = ({ signal }: { signal: AbortSignal }) => {
      signal.addEventListener("abort", () => aborted.resolve(), { once: true });
      fixture.entered.resolve();
      return fixture.held.promise;
    };
    fixture.start();
    const running = fixture.runner.runNow("daily");
    const outcome = running.then(
      () => "resolved",
      () => "rejected",
    );
    await fixture.entered.promise;
    let closed = false;
    const stopping = fixture.runner.stop().then(() => {
      fixture.close();
      closed = true;
    });
    await aborted.promise;
    assert.equal(closed, false);
    assert.equal(fixture.database.open, true);
    assert.equal(fixture.read()?.status, "running");
    await assert.rejects(fixture.runner.runNow("daily"), /not running/);
    assert.equal(
      scheduledJobs.some((timer) => timer.name === "daily"),
      false,
    );
    if (failure === "finish") fixture.fail(/SET finished_at/);
    if (failure === "body") fixture.held.reject(new Error("private"));
    else fixture.held.resolve("saved");
    await assert.doesNotReject(stopping);
    assert.equal(await outcome, failure === "finish" ? "rejected" : "resolved");
    assert.equal(closed, true);
    await assert.doesNotReject(fixture.runner.stop());
  });
}

test("row 13: a throwing reporter never escapes croner", async (context) => {
  const fixture = setup(context);
  fixture.reporter.report = () => {
    throw new Error("logging unavailable");
  };
  fixture.start();
  fixture.fail(/INSERT INTO job_runs/);
  await assert.doesNotReject(fixture.cron().trigger());
  assert.equal(fixture.calls(), 0);
});

for (const [timezone, daily, weekly] of [
  ["America/New_York", "2026-03-08T07:00:00.000Z", "2026-11-02T07:00:00.000Z"],
  ["UTC", "2026-03-08T03:00:00.000Z", "2026-11-02T02:00:00.000Z"],
]) {
  test(`runner's daily and weekly Crons use ${timezone} across DST`, (context) => {
    assert.ok(timezone);
    const fixture = setup(context, timezone);
    fixture.job.schedule = "0 3 * * *";
    fixture.runner.register(fixture.job);
    fixture.runner.register({
      name: "weekly",
      schedule: "0 2 * * 1",
      run: () => "saved",
    });
    fixture.runner.start();
    assert.equal(
      fixture.cron().nextRun(new Date("2026-03-08T00:00:00Z"))?.toISOString(),
      daily,
    );
    assert.equal(
      fixture
        .cron("weekly")
        .nextRun(new Date("2026-11-01T12:00:00Z"))
        ?.toISOString(),
      weekly,
    );
    if (timezone === "America/New_York")
      assert.equal(
        fixture.cron().nextRun(new Date("2026-11-01T00:00:00Z"))?.toISOString(),
        "2026-11-01T08:00:00.000Z",
      );
  });
}

test("records use the injected clock; restarting a job preserves skip columns", async (context) => {
  const fixture = setup(context);
  fixture.clock.now = () => new Date("2026-01-01T12:00:00Z");
  fixture.start();
  const running = fixture.runner.runNow("daily");
  await fixture.entered.promise;
  assert.equal(fixture.read()?.started_at, "2026-01-01T12:00:00.000Z");
  await fixture.runner.runNow("daily");
  fixture.clock.now = () => new Date("2026-01-01T13:00:00Z");
  fixture.held.resolve("saved");
  await running;
  assert.equal(fixture.read()?.finished_at, "2026-01-01T13:00:00.000Z");
  await fixture.runner.runNow("daily");
  assert.equal(fixture.read()?.skipped_count, 1);
  assert.equal(fixture.read()?.last_skipped_at, "2026-01-01T12:00:00.000Z");
});

test("empty runner stops, names are unique, and invalid lifecycle calls fail", async (context) => {
  const fixture = setup(context);
  await assert.rejects(fixture.runner.runNow("missing"), /not running/);
  fixture.runner.register(fixture.job);
  assert.throws(() => fixture.runner.register(fixture.job), /Duplicate job/);
  assert.throws(
    () => fixture.runner.register({ ...fixture.job, name: " " }),
    /name required/,
  );
  fixture.runner.start();
  await assert.rejects(fixture.runner.runNow("missing"), /Unknown job/);
  assert.throws(
    () => fixture.runner.register({ ...fixture.job, name: "other" }),
    /registration closed/,
  );
  await fixture.runner.stop();
  assert.throws(() => fixture.runner.start(), /stopped/);
});

for (const initial of ["manual", "scheduled"] as const) {
  for (const first of ["manual", "scheduled", "trigger"] as const) {
    for (const second of ["manual", "scheduled", "trigger"] as const) {
      test(`overlap model: ${initial} holds through ${first}, ${second}`, async (context) => {
        const fixture = setup(context);
        fixture.start();
        const running =
          initial === "manual"
            ? fixture.runner.runNow("daily")
            : fixture.cron().trigger();
        await fixture.entered.promise;
        let expectedSkips = 0;
        for (const entry of [first, second]) {
          if (entry === "manual") await fixture.runner.runNow("daily");
          else if (entry === "trigger") await fixture.cron().trigger();
          else {
            fixture.skipTick();
            await setImmediate();
          }
          expectedSkips++;
          assert.equal(fixture.calls(), 1);
          assert.equal(fixture.read()?.status, "running");
          assert.equal(fixture.read()?.skipped_count, expectedSkips);
        }
        fixture.held.resolve("");
        await running;
        assert.equal(fixture.read()?.status, "ok");
        assert.equal(fixture.read()?.detail, "");
        await fixture.runner.runNow("daily");
        assert.equal(fixture.calls(), 2);
        assert.equal(fixture.read()?.skipped_count, expectedSkips);
      });
    }
  }
}

test("no registered jobs creates no timers and stops cleanly", async (context) => {
  const fixture = setup(context);
  fixture.runner.start();
  assert.equal(scheduledJobs.length, 0);
  await assert.doesNotReject(fixture.runner.stop());
});

test("a malformed schedule stops timers already created during startup", async (context) => {
  const fixture = setup(context);
  fixture.runner.register(fixture.job);
  fixture.runner.register({
    ...fixture.job,
    name: "malformed",
    schedule: "bad schedule",
  });
  assert.throws(() => fixture.runner.start(), /CronPattern/);
  assert.equal(scheduledJobs.length, 0);
  await assert.rejects(fixture.runner.runNow("daily"), /not running/);
});
