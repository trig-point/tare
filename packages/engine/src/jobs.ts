import type { Database } from "better-sqlite3";
import { Cron } from "croner";
import { interruptRuns } from "./queries/jobs/interrupt-runs.ts";
import { recordFinish } from "./queries/jobs/record-finish.ts";
import { recordSkipped } from "./queries/jobs/record-skipped.ts";
import { recordStart } from "./queries/jobs/record-start.ts";

interface Job {
  name: string;
  schedule: string;
  run(options: { signal: AbortSignal }): Promise<string> | string;
}

interface RunnerOptions {
  database: Database;
  timezone: string;
  clock: { now(): Date };
  report(code: "record_write_failed" | "job_unhandled", jobName: string): void;
}

export function createJobRunner({
  database,
  timezone,
  clock,
  report,
}: RunnerOptions) {
  new Intl.DateTimeFormat("en", { timeZone: timezone });
  const jobs = new Map<string, Job>();
  const timers: Cron[] = [];
  const busy = new Set<string>();
  const pending = new Set<Promise<unknown>>();
  const controller = new AbortController();
  let started = false;
  let stopped = false;
  let stopping: Promise<void> | undefined;

  function reportSafely(
    code: "record_write_failed" | "job_unhandled",
    name: string,
  ) {
    try {
      report(code, name);
    } catch {
      // Reporting must not interrupt a run or escape a scheduler callback.
    }
  }

  function skip(name: string) {
    const record = recordSkipped(
      database,
      { skippedAt: clock.now().toISOString() },
      { jobName: name },
    );
    if (!record) throw new Error("Skip record missing");
    return { status: "skipped" } as const;
  }

  function scheduledSkip(name: string) {
    try {
      skip(name);
    } catch {
      reportSafely("record_write_failed", name);
    }
  }

  function execute(job: Job, manual: boolean) {
    const name = job.name;
    if (stopped) return Promise.reject(new Error("Job runner stopped"));
    if (busy.has(name)) {
      try {
        return Promise.resolve(skip(name));
      } catch (error) {
        if (manual) return Promise.reject(error);
        reportSafely("record_write_failed", name);
        return Promise.resolve();
      }
    }
    busy.add(name);
    try {
      if (
        !recordStart(database, {
          jobName: name,
          startedAt: clock.now().toISOString(),
        })
      )
        throw new Error("Start record missing");
    } catch (error) {
      busy.delete(name);
      if (manual) return Promise.reject(error);
      reportSafely("record_write_failed", name);
      return Promise.resolve();
    }

    // Track the run before its body can call stop or request another run.
    const operation = Promise.resolve().then(async () => {
      try {
        let status: "ok" | "failed" = "ok";
        let detail: string;
        try {
          detail = await job.run({ signal: controller.signal });
        } catch {
          status = "failed";
          detail = "job_failed";
        }
        try {
          const record = recordFinish(
            database,
            { finishedAt: clock.now().toISOString(), status, detail },
            { jobName: name },
          );
          if (!record) throw new Error("Finish record missing");
          return record;
        } catch (error) {
          if (manual) throw error;
          reportSafely("record_write_failed", name);
        }
      } finally {
        busy.delete(name);
      }
    });
    pending.add(operation);
    const release = () => pending.delete(operation);
    operation.then(release, release);
    return operation;
  }

  return {
    register(job: Job) {
      if (started || stopped) throw new Error("Job registration closed");
      if (!job.name.trim()) throw new Error("Job name required");
      if (jobs.has(job.name)) throw new Error(`Duplicate job: ${job.name}`);
      jobs.set(job.name, job);
    },
    start() {
      if (started || stopped)
        throw new Error("Job runner already started or stopped");
      started = true;
      try {
        interruptRuns(database);
        for (const [name, job] of jobs) {
          timers.push(
            new Cron(
              job.schedule,
              {
                timezone,
                name,
                protect: () => scheduledSkip(name),
                catch: () => reportSafely("job_unhandled", name),
              },
              async () => {
                if (stopped) return;
                await execute(job, false);
              },
            ),
          );
        }
      } catch (error) {
        for (const timer of timers) timer.stop();
        stopped = true;
        throw error;
      }
    },
    runNow(name: string) {
      if (!started || stopped)
        return Promise.reject(new Error("Job runner not running"));
      const job = jobs.get(name);
      if (!job) return Promise.reject(new Error(`Unknown job: ${name}`));
      return execute(job, true);
    },
    stop() {
      if (stopping) return stopping;
      stopped = true;
      for (const timer of timers) timer.stop();
      stopping = Promise.allSettled([...pending]).then(() => undefined);
      controller.abort();
      return stopping;
    },
  };
}
