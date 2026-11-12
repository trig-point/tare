import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import { markBackupCopy } from "./db.ts";

interface BackupOptions {
  database: Database;
  directory: string;
  keep: number;
  clock: { now(): Date };
}

const backupName = /^tare-\d{8}T\d{9}Z\.sqlite$/;

export function createBackupJob({
  database,
  directory,
  keep,
  clock,
}: BackupOptions) {
  return {
    name: "backup",
    schedule: "0 3 * * *",
    async run({ signal }: { signal: AbortSignal }) {
      signal.throwIfAborted();
      const timestamp = clock.now().toISOString().replace(/[-:.]/g, "");
      const destination = join(directory, `tare-${timestamp}.sqlite`);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await mkdir(directory, { recursive: true });
        await database.backup(temporary, {
          progress: () => {
            signal.throwIfAborted();
            return 100;
          },
        });
        markBackupCopy(temporary);
        signal.throwIfAborted();
        await rename(temporary, destination);
        const entries = await readdir(directory, { withFileTypes: true });
        const copies = entries
          .filter((entry) => entry.isFile() && backupName.test(entry.name))
          .map((entry) => entry.name)
          .sort();
        for (const name of copies.slice(0, -keep)) {
          signal.throwIfAborted();
          await rm(join(directory, name));
        }
        return "backup_saved";
      } finally {
        for (const suffix of ["", "-wal", "-shm", "-journal"])
          await rm(`${temporary}${suffix}`, { force: true });
      }
    },
  };
}
