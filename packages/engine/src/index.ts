import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { ensureFirstUser, ensureSignInCapableUsers } from "./auth/bootstrap.ts";
import { hashPassword, verifyPassword } from "./auth/password.ts";
import { createBackupJob } from "./backup.ts";
import { createCalendarRefresher } from "./calendar/refresh.ts";
import { createCalendarTransport } from "./calendar/transport.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { createHomeAssistantPublisher } from "./home-assistant/publisher.ts";
import { sensorProvider } from "./home-assistant/snapshot.ts";
import { createOrderEmailParseJob } from "./inbound/job.ts";
import { createOrderQuestionKinds } from "./inbound/questions.ts";
import { createJobRunner } from "./jobs.ts";
import { createOrderMaintenanceJob } from "./orders/maintenance.ts";
import { createOura } from "./oura/service.ts";
import { createOuraSyncJob } from "./oura/sync.ts";
import { deleteExpiredSessions } from "./queries/delete-expired-sessions.ts";
import { createTargetRecomputeJob } from "./target/job.ts";

const config = loadConfig(process.env);
const connection = openDatabase(config.databaseUrl);
await ensureFirstUser(
  connection.database,
  config.firstUser,
  config.timezone,
  { now: () => new Date() },
  hashPassword,
  config.identity,
)
  .then(() => ensureSignInCapableUsers(connection.database, config.identity))
  .then(startEngine, (error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "First administrator setup failed",
    );
    connection.close();
    process.exitCode = 1;
  });

async function startEngine() {
  const clock = { now: () => new Date() };
  const calendar = createCalendarRefresher({
    database: connection.database,
    clock,
    transport: createCalendarTransport(),
  });
  const oura = createOura({ database: connection.database, config, clock });
  oura.cleanup();
  const questionKinds = createOrderQuestionKinds({
    clock,
    services: config.orderEmailServices,
  });
  deleteExpiredSessions(connection.database, {
    now: clock.now().toISOString(),
  });
  const dummyHash = await hashPassword(randomBytes(32).toString("base64url"));
  const homeAssistant = config.mqtt
    ? createHomeAssistantPublisher({
        database: connection.database,
        config: config.mqtt,
      })
    : undefined;
  homeAssistant?.addProvider(
    sensorProvider(connection.database, clock, config.tdee),
  );
  const runner = createJobRunner({
    database: connection.database,
    timezone: config.timezone,
    clock,
    report: (code, jobName) => console.error(code, jobName),
  });
  if (config.backupDir !== undefined) {
    runner.register(
      createBackupJob({
        database: connection.database,
        directory: config.backupDir,
        keep: config.backupKeep,
        clock,
      }),
    );
  } else console.info("Backups disabled");
  runner.register(
    createOrderMaintenanceJob({ database: connection.database, clock }),
  );
  runner.register(
    createTargetRecomputeJob({
      database: connection.database,
      clock,
      settings: config.tdee,
      weekday: config.targetWeekday,
      onFinished: () => homeAssistant?.refreshAll(),
    }),
  );
  runner.register(
    createOrderEmailParseJob({
      database: connection.database,
      clock,
      model: config.orderModel,
      questionKinds,
      services: config.orderEmailServices,
    }),
  );
  runner.register(oura.job);
  runner.register(
    createOuraSyncJob({ database: connection.database, oura, clock }),
  );
  runner.register(calendar.job);
  calendar.start();
  runner.start();
  const app = createApp({
    database: connection.database,
    config,
    clock,
    dummyHash,
    questionKinds,
    verifyPassword,
    oura,
    calendar,
    homeAssistant,
    onEmailQueued: () => runner.runNow("order-email-parse"),
    webRoot: fileURLToPath(new URL("../../../apps/web/dist/", import.meta.url)),
  });
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
        oura.stop(),
        calendar.stop(),
        homeAssistant?.stop(),
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
