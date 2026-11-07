import type { Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { TrieRouter } from "hono/router/trie-router";
import {
  type AuthEnv,
  authenticatedPerson,
  requireRequestedWith,
  sessionAuth,
} from "../auth/middleware.ts";
import {
  authorizeCaller,
  authorizeOperation,
  executeOperation,
  type Operation,
  type OperationDependencies,
  OperationError,
  type OperationIdentity,
} from "./registry.ts";

export function operationGuards(
  operations: Operation[],
  mode: "access" | "fallback",
  transports: { method: string; path: string }[] = [],
) {
  const service = new TrieRouter<boolean>();
  const privatePaths = new TrieRouter<boolean>();
  for (const operation of operations) {
    privatePaths.add("ALL", operation.path, true);
    if (operation.noStoreSubpaths)
      privatePaths.add("ALL", `${operation.path}/*`, true);
    if (
      operation.callerClass === "browser_and_agent" &&
      operation.modes.includes(mode)
    )
      service.add(operation.method, operation.path, true);
  }
  for (const transport of transports)
    service.add(transport.method, transport.path, true);
  const noStore: MiddlewareHandler<AuthEnv> = async (context, next) => {
    if (privatePaths.match("ALL", context.req.path)[0].length > 0)
      context.header("Cache-Control", "no-store");
    await next();
  };
  const serviceRoutes: MiddlewareHandler<AuthEnv> = async (context, next) => {
    if (
      context.get("credential") === "service" &&
      service.match(context.req.method, context.req.path)[0].length === 0
    )
      return context.json({ error: { code: "forbidden" } }, 403);
    await next();
  };
  return { noStore, serviceRoutes };
}

export function mountOperations(
  app: Hono<AuthEnv>,
  operations: Operation[],
  deps: OperationDependencies,
) {
  const names = new Set<string>();
  const routes = new Set<string>();
  const authenticate =
    deps.config.identity.mode === "access"
      ? authenticatedPerson
      : sessionAuth(deps.database, deps.clock);
  const cookieOptions = {
    httpOnly: true,
    sameSite: "Lax" as const,
    secure:
      deps.config.publicUrl !== undefined &&
      new URL(deps.config.publicUrl).protocol === "https:",
    path: "/",
    maxAge: deps.config.sessionDays * 86_400,
  };
  for (const operation of operations) {
    const route = `${operation.method} ${operation.path}`;
    if (names.has(operation.name) || routes.has(route))
      throw new Error("Duplicate operation");
    names.add(operation.name);
    routes.add(route);
    if (!operation.modes.includes(deps.config.identity.mode)) continue;
    const identity = (
      context: Parameters<MiddlewareHandler<AuthEnv>>[0],
    ): OperationIdentity => ({
      person: context.get("person"),
      credential: context.get("credential"),
      sessionToken: getCookie(context, "tare_session"),
    });
    const caller: MiddlewareHandler<AuthEnv> = async (context, next) => {
      authorizeCaller(operation, identity(context));
      await next();
    };
    const admin: MiddlewareHandler<AuthEnv> = async (context, next) => {
      authorizeOperation(operation, identity(context), deps);
      await next();
    };
    app.on(
      [operation.method],
      [operation.path],
      ...(operation.callerClass === "public" ? [] : [authenticate]),
      caller,
      requireRequestedWith,
      admin,
      ...(operation.bodyLimit === undefined
        ? []
        : [
            bodyLimit({
              maxSize: operation.bodyLimit,
              onError: (context) =>
                context.json({ error: { code: "body_too_large" } }, 413),
            }),
          ]),
      async (context) => {
        let rawInput: unknown = context.req.param();
        if (operation.method === "POST" || operation.method === "PATCH") {
          try {
            rawInput = await context.req.json();
            if (operation.method === "PATCH") {
              if (
                !rawInput ||
                typeof rawInput !== "object" ||
                Array.isArray(rawInput)
              )
                throw new OperationError(400, "invalid_request");
              rawInput = { ...rawInput, ...context.req.param() };
            }
          } catch {
            throw new OperationError(400, "invalid_request");
          }
        }
        const result = await executeOperation(
          operation,
          rawInput,
          identity(context),
          deps,
        );
        if (result.effects?.setSessionCookie !== undefined)
          setCookie(
            context,
            "tare_session",
            result.effects.setSessionCookie,
            cookieOptions,
          );
        if (result.effects?.clearSessionCookie)
          deleteCookie(context, "tare_session", cookieOptions);
        if (result.status === 302) return context.redirect("/", 302);
        return result.status === 204
          ? context.body(null, 204)
          : context.json(result.body, result.status);
      },
    );
  }
}
