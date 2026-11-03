import { Hono } from "hono";
import { createRemoteJWKSet } from "jose";
import { createAccessVerifier } from "./auth/access.ts";
import { type AuthEnv, accessAuth } from "./auth/middleware.ts";
import type { AppOptions } from "./auth/routes.ts";
import { mountOperations, operationGuards } from "./operations/http.ts";
import { operations } from "./operations/index.ts";
import { OperationError } from "./operations/registry.ts";

export function createApp(options: AppOptions) {
  const app = new Hono<AuthEnv>();
  const guards = operationGuards(operations, options.config.identity.mode);
  app.use("*", guards.noStore);
  app.onError((error, context) => {
    if (error instanceof OperationError) {
      for (const [name, value] of Object.entries(error.headers))
        context.header(name, value);
      return context.json({ error: { code: error.code } }, error.status);
    }
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
    app.use("*", guards.serviceRoutes);
  }
  mountOperations(app, operations, {
    ...options,
    signInLimiter: { waiting: 0 },
  });
  return app;
}
