import { setImmediate } from "node:timers/promises";
import type { Database } from "better-sqlite3";
import type { TdeeSettings } from "../config.ts";
import { writeTransaction } from "../db.ts";
import { listTargetPeople } from "../queries/list-target-people.ts";
import { selectPerson } from "../queries/select-person.ts";
import { recomputeTarget } from "./recompute.ts";

export function createTargetRecomputeJob({
  database,
  clock,
  settings,
  weekday,
}: {
  database: Database;
  clock: { now(): Date };
  settings: TdeeSettings;
  weekday: number;
}) {
  return {
    name: "target-recompute",
    schedule: `0 3 * * ${weekday}`,
    async run({ signal }: { signal: AbortSignal }) {
      signal.throwIfAborted();
      let recomputed = 0;
      let failed = 0;
      for (const { user_id } of listTargetPeople(database)) {
        await setImmediate(undefined, { signal });
        try {
          const result = writeTransaction(database, (scope) => {
            const person = selectPerson(database, { id: user_id });
            if (!person) throw new Error("Target owner missing");
            return recomputeTarget(
              scope,
              person,
              clock.now(),
              settings,
              "weekly",
            );
          });
          if (result.stored) recomputed++;
        } catch (error) {
          failed++;
          console.error(
            "target_recompute_failed",
            user_id,
            error instanceof Error ? error.name : "UnknownError",
          );
        }
      }
      const result = `targets_recomputed:${recomputed}`;
      if (failed) {
        console.error(`${result} failed:${failed}`);
        throw new Error("Target recompute failed");
      }
      return result;
    },
  };
}
