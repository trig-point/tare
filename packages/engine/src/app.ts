import { Hono } from "hono";
import { createRemoteJWKSet } from "jose";
import { createAccessVerifier } from "./auth/access.ts";
import {
  type AuthEnv,
  accessAuth,
  restrictServiceRoutes,
} from "./auth/middleware.ts";
import { type AppOptions, mountAuthRoutes } from "./auth/routes.ts";

export function createApp(options: AppOptions) {
  const app = new Hono<AuthEnv>();
  app.use("*", async (context, next) => {
    if (
      ["/api/session", "/api/users", "/api/me", "/api/agent-tokens"].includes(
        context.req.path,
      ) ||
      context.req.path.startsWith("/api/agent-tokens/")
    )
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
  if (options.config.identity.mode === "access") {
    const { teamDomain, audience } = options.config.identity;
    app.use(
      "*",
      accessAuth(
        options.database,
        createAccessVerifier({
          teamDomain,
          audience,
          keySet:
            options.accessKeySet ??
            createRemoteJWKSet(new URL("/cdn-cgi/access/certs", teamDomain)),
          now: () => options.clock.now(),
        }),
        options.clock,
      ),
    );
    app.use("*", restrictServiceRoutes);
  }
  mountAuthRoutes(app, options);
  return app;
}
