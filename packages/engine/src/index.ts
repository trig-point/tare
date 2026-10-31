import { createApp } from "./app";
import { loadConfig } from "./config";
import { openDatabase } from "./db";

const config = loadConfig(process.env);
const connection = openDatabase(config.databaseUrl);
const app = createApp();
const server = Bun.serve({ port: config.port, fetch: app.fetch });
console.info(`Engine listening on port ${server.port}`);

function shutdown() {
  server.stop(true);
  connection.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
