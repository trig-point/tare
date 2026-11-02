import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackupJob } from "../src/backup.ts";
import { openDatabase } from "../src/db.ts";
import { createJobRunner } from "../src/jobs.ts";
import { cookie, fixture } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";

for (const behavior of ["restore", "retention"])
  test(behavior, async (context) => {
    const { database, signIn } = fixture(context);
    const directory = fs.mkdtempSync(join(tmpdir(), "tare-backup-"));
    const session = cookie(await signIn());
    const clock = { now: () => new Date("2026-01-01T00:00:00Z") };
    const options = { database, clock, timezone: "UTC", report: assert.fail };
    const runner = createJobRunner(options);
    runner.register(createBackupJob({ ...options, directory, keep: 2 }));
    let day = 0;
    const backup = database.backup.bind(database);
    const write = database.prepare("UPDATE users SET day_start_hour = ?");
    context.mock.method(database, "backup", (file: string) =>
      backup(file, { progress: () => write.run(day + 4).changes }),
    );
    runner.start();
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    context.after(() => runner.stop());
    fs.writeFileSync(join(directory, "note"), "keep");
    for (day of [1, 2, 3]) {
      clock.now = () => new Date(Date.UTC(2026, 0, day));
      assert.equal((await runner.runNow("backup")).status, "ok");
    }
    if (behavior === "retention")
      return assert.deepEqual(fs.readdirSync(directory).sort(), [
        "note",
        "tare-20260102T000000000Z.sqlite",
        "tare-20260103T000000000Z.sqlite",
      ]);
    const file = join(directory, "tare-20260103T000000000Z.sqlite");
    async function check() {
      const { database: db, close } = openDatabase(file);
      try {
        assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
        assert.deepEqual(db.pragma("foreign_key_check"), []);
        const { app } = fixture(context, { database: db });
        const headers = { Cookie: session };
        const response = await app.request("/api/session", { headers });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).user.day_start_hour, day + 4);
      } finally {
        close();
      }
    }
    await check();
    fs.writeFileSync(file, "broken-header!!!");
    await assert.rejects(check, /not a database/);
  });
