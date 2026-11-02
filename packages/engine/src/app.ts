import { Hono } from "hono";
import type { AuthEnv } from "./auth/middleware.ts";
import { type AppOptions, mountAuthRoutes } from "./auth/routes.ts";

export function createApp(options: AppOptions) {
  const app = new Hono<AuthEnv>();
  app.use("*", async (context, next) => {
    if (context.req.path === "/api/session")
      context.header("Cache-Control", "no-store");
    await next();
  });
  app.onError((error, context) => {
    // Name only: messages can carry request data, which stays out of logs.
    console.error("request_failed", error.name);
    return context.json({ error: { code: "internal" } }, 500);
  });
  app.notFound((context) =>
    context.json({ error: { code: "not_found" } }, 404),
  );
  app.get("/health", (context) => context.json({ status: "ok" }));
  mountAuthRoutes(app, options);
  return app;
}
