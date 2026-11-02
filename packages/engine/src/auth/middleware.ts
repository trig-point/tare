import type { Database } from "better-sqlite3";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { selectSessionUser } from "../queries/select-session-user.ts";
import { hashToken } from "./sessions.ts";

export type SessionPerson = NonNullable<ReturnType<typeof selectSessionUser>>;
export type AuthEnv = {
  Variables: { person: SessionPerson; credential: string | undefined };
};

export const hasRequestedWith = (context: Context<AuthEnv>): boolean =>
  context.req.header("X-Requested-With") === "XMLHttpRequest";

// Allowing credentialed cross-origin callers removes this protection.
export const requireRequestedWith: MiddlewareHandler<AuthEnv> = async (
  context,
  next,
) => {
  const credential = context.get("credential");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(context.req.method) &&
    (credential === undefined || credential === "session") &&
    !hasRequestedWith(context)
  )
    return context.json({ error: { code: "requested_with_required" } }, 403);
  await next();
};

export function sessionAuth(
  database: Database,
  clock: { now(): Date },
): MiddlewareHandler<AuthEnv> {
  return async (context, next) => {
    const token = getCookie(context, "tare_session");
    const person = token
      ? selectSessionUser(database, {
          token_hash: hashToken(token),
          now: clock.now().toISOString(),
        })
      : null;
    if (!person)
      return context.json({ error: { code: "unauthenticated" } }, 401);
    context.set("person", person);
    context.set("credential", "session");
    await next();
  };
}
