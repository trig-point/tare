import type { Database } from "better-sqlite3";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { selectSessionUser } from "../queries/select-session-user.ts";
import { selectUser } from "../queries/select-user.ts";
import { selectUserByAccessEmail } from "../queries/select-user-by-access-email.ts";
import { useAgentToken } from "../queries/use-agent-token.ts";
import { type AccessIdentity, normalizeAccessEmail } from "./access.ts";
import { hashToken } from "./sessions.ts";

export type Person = Omit<
  NonNullable<ReturnType<typeof selectSessionUser>>,
  "expires_at"
>;
export type AuthEnv = {
  Variables: {
    person: Person;
    credential: "session" | "access" | "service" | undefined;
  };
};

export function currentPerson(context: Context<AuthEnv>): Person {
  const person = context.get("person");
  if (!person) throw new Error("Authenticated person missing");
  return person;
}

export const authenticatedPerson: MiddlewareHandler<AuthEnv> = async (
  context,
  next,
) => {
  currentPerson(context);
  await next();
};

export function accessAuth(
  database: Database,
  verify: (token: string) => Promise<AccessIdentity | null>,
  clock: { now(): Date },
): MiddlewareHandler<AuthEnv> {
  const exemptPaths = ["/health"];
  return async (context, next) => {
    if (exemptPaths.includes(context.req.path)) return next();
    const token = context.req.header("Cf-Access-Jwt-Assertion");
    const identity = token ? await verify(token) : null;
    if (!identity)
      return context.json({ error: { code: "unauthenticated" } }, 401);
    if (identity.kind === "service") {
      const [mapping] = useAgentToken(
        database,
        { now: clock.now().toISOString() },
        { client_id: identity.commonName.trim() },
      );
      const person = mapping
        ? selectUser(database, { id: mapping.user_id })
        : null;
      if (!person)
        return context.json({ error: { code: "unknown_agent" } }, 403);
      context.set("person", person);
      context.set("credential", "service");
      return next();
    }
    const email = normalizeAccessEmail(identity.email);
    if (email === null)
      return context.json({ error: { code: "unauthenticated" } }, 401);
    const person = selectUserByAccessEmail(database, { access_email: email });
    if (!person) return context.json({ error: { code: "not_a_member" } }, 403);
    context.set("person", person);
    context.set("credential", "access");
    await next();
  };
}

export const restrictServiceRoutes: MiddlewareHandler<AuthEnv> = async (
  context,
  next,
) => {
  if (
    context.get("credential") === "service" &&
    !(context.req.method === "GET" && context.req.path === "/api/me")
  )
    return context.json({ error: { code: "forbidden" } }, 403);
  await next();
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
    credential !== "service" &&
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
    const { expires_at: _expiresAt, ...authenticated } = person;
    context.set("person", authenticated);
    context.set("credential", "session");
    await next();
  };
}

export function requireAdmin(database: Database): MiddlewareHandler<AuthEnv> {
  return async (context, next) => {
    const credential = context.get("credential");
    if (credential !== "session" && credential !== "access")
      return context.json({ error: { code: "forbidden" } }, 403);
    const person = currentPerson(context);
    if (!selectUser(database, { id: person.id })?.is_admin)
      return context.json({ error: { code: "forbidden" } }, 403);
    await next();
  };
}
