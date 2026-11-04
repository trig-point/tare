import type { Hono } from "hono";
import {
  type AuthEnv,
  authenticatedPerson,
  sessionAuth,
} from "../auth/middleware.ts";
import type { AppOptions } from "../auth/routes.ts";
import type { OuraService } from "./service.ts";

export function mountOuraCallback(
  app: Hono<AuthEnv>,
  deps: Pick<AppOptions, "config" | "database" | "clock"> & {
    oura: OuraService;
  },
) {
  app.get(
    "/api/oura/callback",
    deps.config.identity.mode === "access"
      ? authenticatedPerson
      : sessionAuth(deps.database, deps.clock),
    async (context) => {
      context.header("Cache-Control", "no-store");
      const person = context.get("person");
      const credential = context.get("credential");
      if (!person || (credential !== "session" && credential !== "access"))
        return context.json({ error: { code: "forbidden" } }, 403);
      try {
        const connected = await deps.oura.callback(
          person.id,
          new URL(context.req.url),
        );
        return context.redirect(
          connected ? "/?oura=connected" : "/?oura=failed",
          303,
        );
      } catch {
        return context.redirect("/?oura=failed", 303);
      }
    },
  );
}
