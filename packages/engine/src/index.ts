import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { ensureFirstUser } from "./auth/bootstrap.ts";
import { hashPassword } from "./auth/password.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { createJobRunner } from "./jobs.ts";

const config = loadConfig(process.env);
const connection = openDatabase(config.databaseUrl);
await ensureFirstUser(
  connection.database,
  config.firstUser,
  config.timezone,
  { now: () => new Date() },
  hashPassword,
).then(startEngine, (error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "First administrator setup failed",
  );
  connection.close();
  process.exitCode = 1;
});

function startEngine() {
  const runner = createJobRunner({
    database: connection.database,
    timezone: config.timezone,
    clock: { now: () => new Date() },
    report: (code, jobName) => console.error(code, jobName),
  });
  runner.start();
  const app = createApp();
  const server = serve({ port: config.port, fetch: app.fetch }, (address) => {
    console.info(`Engine listening on port ${address.port}`);
  });

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    try {
      const results = await Promise.allSettled([
        runner.stop(),
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
      ]);
      if (results.some((result) => result.status === "rejected")) {
        console.error("shutdown_failed");
        process.exitCode = 1;
      }
    } finally {
      connection.close();
    }
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
