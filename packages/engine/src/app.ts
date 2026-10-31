import { Hono } from "hono";

export function createApp() {
  const app = new Hono();
  app.get("/health", (context) => context.json({ status: "ok" }));
  return app;
}
