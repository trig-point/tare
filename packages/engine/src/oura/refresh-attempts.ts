import { Mutex } from "async-mutex";
import type { Database } from "better-sqlite3";
import {
  type Access,
  type RefreshResult,
  refreshError,
} from "./refresh-result.ts";

interface Attachment {
  attempt: Attempt;
  finish(result: RefreshResult): void;
}
interface Entry {
  mutex: Mutex;
  reservations: number;
  current?: Attempt;
}
export interface Attempt {
  controller: AbortController;
  callers: Set<Attachment>;
  validated: boolean;
  joinable: boolean;
  settled: Promise<void>;
}
const databases = new WeakMap<Database, Map<number, Entry>>();

export function createRefreshCallers() {
  let stopped = false;
  const callers = new Set<Attachment>();
  const owned = new Set<Promise<void>>();
  return {
    refresh(
      database: Database,
      owner: number,
      run: (attempt: Attempt) => Promise<RefreshResult>,
    ): Promise<Access> {
      if (stopped) return Promise.reject(refreshError("oura_unavailable"));
      let entries = databases.get(database);
      if (!entries) {
        entries = new Map();
        databases.set(database, entries);
      }
      let entry = entries.get(owner);
      if (!entry) {
        entry = { mutex: new Mutex(), reservations: 0 };
        entries.set(owner, entry);
      }
      let attempt = entry.current;
      let start: (() => void) | undefined;
      if (!attempt?.joinable) {
        let settle!: () => void;
        attempt = {
          controller: new AbortController(),
          callers: new Set(),
          validated: false,
          joinable: true,
          settled: new Promise<void>((resolve) => {
            settle = resolve;
          }),
        };
        entry.current = attempt;
        entry.reservations++;
        const reserved = entry;
        const registry = entries;
        const current = attempt;
        start = () => {
          void (async () => {
            let release: (() => void) | undefined;
            let result: RefreshResult = "oura_unavailable";
            try {
              release = await reserved.mutex.acquire();
              if (current.callers.size > 0) result = await run(current);
            } catch {
              result = "oura_unavailable";
            } finally {
              current.joinable = false;
              if (reserved.current === current) reserved.current = undefined;
              release?.();
              reserved.reservations--;
              if (
                reserved.reservations === 0 &&
                registry.get(owner) === reserved
              )
                registry.delete(owner);
              for (const caller of [...current.callers]) caller.finish(result);
              settle();
            }
          })();
        };
      }
      const attached = attempt;
      const promise = new Promise<Access>((resolve, reject) => {
        const caller: Attachment = {
          attempt: attached,
          finish(result) {
            callers.delete(caller);
            attached.callers.delete(caller);
            if (typeof result === "string") reject(refreshError(result));
            else resolve(result);
          },
        };
        callers.add(caller);
        attached.callers.add(caller);
      });
      start?.();
      return promise;
    },
    stop(): Promise<void> {
      stopped = true;
      for (const caller of [...callers]) {
        const attempt = caller.attempt;
        caller.finish("oura_unavailable");
        if (attempt.callers.size !== 0) continue;
        attempt.joinable = false;
        owned.add(attempt.settled);
        if (!attempt.validated) attempt.controller.abort();
      }
      return Promise.allSettled([...owned]).then(() => undefined);
    },
  };
}
