import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";

const config = loadConfig(process.env);
const connection = openDatabase(config.databaseUrl);
const app = createApp();
const server = serve({ port: config.port, fetch: app.fetch }, (address) => {
  console.info(`Engine listening on port ${address.port}`);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) process.exit(1);
  shuttingDown = true;
  server.close(() => connection.close());
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
