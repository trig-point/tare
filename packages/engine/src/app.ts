import { Hono } from "hono";
import { createRemoteJWKSet } from "jose";
import { createAccessVerifier } from "./auth/access.ts";
import { type AuthEnv, accessAuth } from "./auth/middleware.ts";
import type { AppOptions } from "./auth/routes.ts";
import { createCalendarRefresher } from "./calendar/refresh.ts";
import { createCalendarTransport } from "./calendar/transport.ts";
import { safeGrocyText } from "./grocy/config.ts";
import { type InboundOptions, mountInboundEmail } from "./inbound/endpoint.ts";
import { createOrderQuestionKinds } from "./inbound/questions.ts";
import { mountMcp } from "./mcp/server.ts";
import { mountOperations, operationGuards } from "./operations/http.ts";
import { operations } from "./operations/index.ts";
import { OperationError } from "./operations/registry.ts";
import { mountOuraCallback } from "./oura/callback.ts";
import { createOura } from "./oura/service.ts";
import { pantryEgress } from "./pantry/egress.ts";
import { createOffAdapter } from "./sources/off.ts";
import { createUsdaAdapter } from "./sources/usda.ts";
import { mountWeb } from "./web.ts";

export function createApp(
  options: AppOptions & InboundOptions & { webRoot?: string },
) {
  if (options.config.grocy && !options.pantry)
    throw new Error("Pantry service required");
  const dependencies = {
    ...options,
    calendar:
      options.calendar ??
      createCalendarRefresher({
        ...options,
        transport: createCalendarTransport(),
      }),
    oura: options.oura ?? createOura(options),
    questionKinds:
      options.questionKinds ??
      createOrderQuestionKinds({
        clock: options.clock,
        services: options.config.orderEmailServices,
      }),
    lookup: options.lookup ?? {
      usda: createUsdaAdapter(options.config, {
        now: () => options.clock.now(),
      }),
      off: createOffAdapter({ userAgent: options.config.offUserAgent }),
    },
    signInLimiter: { waiting: 0 },
  };
  const app = new Hono<AuthEnv>();
  const guards = operationGuards(
    operations,
    options.config.identity.mode,
    options.config.identity.mode === "access"
      ? ["GET", "POST", "DELETE"].map((method) => ({ method, path: "/mcp" }))
      : [],
  );
  app.use("*", pantryEgress(options.config.grocy));
  app.use("*", guards.noStore);
  app.onError((error, context) => {
    if (error instanceof OperationError) {
      for (const [name, value] of Object.entries(error.headers))
        context.header(name, value);
      return context.json(
        {
          error: {
            code: error.code,
            ...(error.issues ? { issues: error.issues } : {}),
          },
        },
        error.status,
      );
    }
    // Name only: messages can carry request data, which stays out of logs.
    const message = safeGrocyText(
      `request_failed ${error.name}`,
      options.config.grocy?.apiKey,
    );
    if (message === `request_failed ${error.name}`)
      console.error("request_failed", error.name);
    else if (message !== undefined) console.error(message);
    return context.json({ error: { code: "internal" } }, 500);
  });
  app.notFound((context) =>
    context.json({ error: { code: "not_found" } }, 404),
  );
  app.get("/health", (context) => context.json({ status: "ok" }));
  mountInboundEmail(app, dependencies);
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
  mountOuraCallback(app, dependencies);
  mountOperations(app, operations, dependencies);
  if (options.config.identity.mode === "access") mountMcp(app, dependencies);
  mountWeb(app, options.webRoot);
  return app;
}
