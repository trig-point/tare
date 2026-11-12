import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { ensureFirstUser, ensureSignInCapableUsers } from "./auth/bootstrap.ts";
import { hashPassword, verifyPassword } from "./auth/password.ts";
import { createBackupJob } from "./backup.ts";
import { createCalendarRefresher } from "./calendar/refresh.ts";
import { createCalendarTransport } from "./calendar/transport.ts";
import { loadStartupConfig, reportStartupError } from "./config.ts";
import { openDatabase } from "./db.ts";
import { resolveGrocyOwner, safeGrocyText } from "./grocy/config.ts";
import { createMealButtons } from "./home-assistant/meal-buttons.ts";
import { nextSlotProvider } from "./home-assistant/next-slot.ts";
import { createHomeAssistantPublisher } from "./home-assistant/publisher.ts";
import { sensorProvider } from "./home-assistant/snapshot.ts";
import { targetEventProvider } from "./home-assistant/target-event.ts";
import { createOrderEmailParseJob } from "./inbound/job.ts";
import { createOrderQuestionKinds } from "./inbound/questions.ts";
import { createJobRunner } from "./jobs.ts";
import { createOrderMaintenanceJob } from "./orders/maintenance.ts";
import { createOura } from "./oura/service.ts";
import { createOuraSyncJob } from "./oura/sync.ts";
import { recoverRequests } from "./pantry/requests.ts";
import { createPantryService } from "./pantry/service.ts";
import { deleteExpiredSessions } from "./queries/delete-expired-sessions.ts";
import { createScaleSubscriber, resolveScaleUsers } from "./scale/ingest.ts";
import { createTargetRecomputeJob } from "./target/job.ts";

const config = loadStartupConfig(process.env) ?? process.exit(1);
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
  .then(() =>
    config.scale ? resolveScaleUsers(connection.database, config.scale) : null,
  )
  .then(startEngine)
  .catch((error: unknown) => {
    reportStartupError(error, config.grocy?.apiKey);
    connection.close();
    process.exitCode = 1;
  });

async function startEngine(scaleUsers: Map<string, number> | null) {
  const clock = { now: () => new Date() };
  recoverRequests(connection.database, clock);
  const pantry = createPantryService({
    database: connection.database,
    config: config.grocy,
    ownerId: resolveGrocyOwner(connection.database, config.grocy),
    clock,
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
    sensorProvider(connection.database, clock, config),
  );
  homeAssistant?.addProvider(targetEventProvider(connection.database));
  if (homeAssistant)
    homeAssistant.addProvider(
      createMealButtons({
        database: connection.database,
        publisher: homeAssistant,
      }).provider,
    );
  homeAssistant?.addProvider(
    nextSlotProvider(connection.database, clock, config),
  );
  const calendar = createCalendarRefresher({
    database: connection.database,
    clock,
    transport: createCalendarTransport(),
    onChanged: () => homeAssistant?.refreshAll(),
  });
  if (homeAssistant && config.scale && scaleUsers) {
    const handleReading = createScaleSubscriber({
      database: connection.database,
      topic: config.scale.topic,
      users: scaleUsers,
      questionKinds,
      clock,
      onLogged: () => homeAssistant.refreshAll(),
    });
    homeAssistant.subscribe(`${config.scale.topic}/+`, handleReading);
    homeAssistant.subscribe(config.scale.topic, handleReading);
  }
  const runner = createJobRunner({
    database: connection.database,
    timezone: config.timezone,
    clock,
    report: (code, jobName) => {
      if (
        jobName !== "pantry-refresh" ||
        !config.grocy ||
        !`${code} ${jobName}`.includes(config.grocy.apiKey)
      )
        console.error(code, jobName);
    },
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
    createOuraSyncJob({
      database: connection.database,
      oura,
      clock,
      creditMode: config.activityCredit,
      onFinished: () => homeAssistant?.refreshAll(),
    }),
  );
  runner.register(calendar.job);
  calendar.start();
  if (config.grocy) runner.register(pantry.job);
  runner.start();
  if (config.grocy) {
    const reportFailure = () => {
      const message = safeGrocyText(
        "pantry_startup_failed",
        config.grocy?.apiKey,
      );
      if (message !== undefined) console.error(message);
    };
    void runner.runNow(pantry.job.name).then((result) => {
      if (result.status === "failed") reportFailure();
    }, reportFailure);
  }
  const app = createApp({
    database: connection.database,
    config,
    clock,
    dummyHash,
    pantry,
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
    const pantryStopped = pantry.stop();
    try {
      const results = await Promise.allSettled([
        runner.stop(),
        pantryStopped,
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
