import type { Database } from "better-sqlite3";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { type Config, validateTimezone } from "../config.ts";
import { deleteSession } from "../queries/delete-session.ts";
import { insertAccount } from "../queries/insert-account.ts";
import { selectUserByUsername } from "../queries/select-user-by-username.ts";
import {
  type AuthEnv,
  hasRequestedWith,
  requireAdmin,
  requireRequestedWith,
  sessionAuth,
} from "./middleware.ts";
import {
  hashPassword,
  isValidPassword,
  normalizeUsername,
} from "./password.ts";
import { createSession, hashToken } from "./sessions.ts";

export interface AppOptions {
  database: Database;
  config: Config;
  clock: { now(): Date };
  dummyHash: string;
  verifyPassword(password: string, stored: string): Promise<boolean>;
}

function toPublicUser(person: {
  id: number;
  username: string;
  timezone: string;
  day_start_hour: number;
  is_admin: number;
}) {
  return {
    id: person.id,
    username: person.username,
    timezone: person.timezone,
    day_start_hour: person.day_start_hour,
    is_admin: Boolean(person.is_admin),
  };
}

async function readJsonBody(context: Context<AuthEnv>) {
  try {
    const body: unknown = await context.req.json();
    if (body === null || typeof body !== "object" || Array.isArray(body))
      return null;
    const fields = body as Record<string, unknown>;
    const username = normalizeUsername(fields.username);
    if (username === null || !isValidPassword(fields.password)) return null;
    return { username, password: fields.password, timezone: fields.timezone };
  } catch {
    return null;
  }
}

export function mountAuthRoutes(app: Hono<AuthEnv>, options: AppOptions) {
  const { database, config, clock, dummyHash, verifyPassword } = options;
  const cookieOptions = {
    httpOnly: true,
    sameSite: "Lax" as const,
    secure:
      config.publicUrl !== undefined &&
      new URL(config.publicUrl).protocol === "https:",
    path: "/",
    maxAge: config.sessionDays * 86_400,
  };
  const limit = bodyLimit({
    maxSize: 8192,
    onError: (context) =>
      context.json({ error: { code: "body_too_large" } }, 413),
  });
  const authenticate = sessionAuth(database, clock);
  let waiting = 0;

  app.post(
    "/api/session",
    async (context, next) => {
      if (!hasRequestedWith(context))
        return context.json(
          { error: { code: "requested_with_required" } },
          403,
        );
      await next();
    },
    limit,
    async (context) => {
      const body = await readJsonBody(context);
      if (!body)
        return context.json({ error: { code: "invalid_request" } }, 400);
      if (waiting >= 8) {
        context.header("Retry-After", "1");
        return context.json({ error: { code: "busy" } }, 503);
      }
      waiting++;
      try {
        const person = selectUserByUsername(database, {
          username: body.username,
        });
        if (!person) {
          await verifyPassword(body.password, dummyHash);
          return context.json({ error: { code: "invalid_credentials" } }, 401);
        }
        if (!(await verifyPassword(body.password, person.password_hash)))
          return context.json({ error: { code: "invalid_credentials" } }, 401);
        const token = createSession(
          database,
          person.id,
          getCookie(context, "tare_session"),
          clock.now(),
          config.sessionDays,
        );
        setCookie(context, "tare_session", token, cookieOptions);
        return context.json({ user: toPublicUser(person) });
      } finally {
        waiting--;
      }
    },
  );

  app.get("/api/session", authenticate, (context) =>
    context.json({ user: toPublicUser(context.get("person")) }),
  );
  app.delete("/api/session", authenticate, requireRequestedWith, (context) => {
    const token = getCookie(context, "tare_session");
    if (token === undefined)
      throw new Error("Authenticated session cookie missing");
    deleteSession(database, { token_hash: hashToken(token) });
    deleteCookie(context, "tare_session", cookieOptions);
    return context.body(null, 204);
  });

  app.post(
    "/api/users",
    authenticate,
    requireRequestedWith,
    requireAdmin(database),
    limit,
    async (context) => {
      const body = await readJsonBody(context);
      if (
        !body ||
        (body.timezone !== undefined && typeof body.timezone !== "string")
      )
        return context.json({ error: { code: "invalid_request" } }, 400);
      let timezone: string;
      try {
        timezone = validateTimezone(
          body.timezone ?? context.get("person").timezone,
        );
      } catch {
        return context.json({ error: { code: "invalid_request" } }, 400);
      }
      const passwordHash = await hashPassword(body.password);
      try {
        const person = insertAccount(database, {
          username: body.username,
          password_hash: passwordHash,
          timezone,
          is_admin: 0,
          created_at: clock.now().toISOString(),
        });
        if (!person) throw new Error("Could not create user");
        return context.json({ user: toPublicUser(person) }, 201);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "SQLITE_CONSTRAINT_UNIQUE"
        )
          return context.json({ error: { code: "username_taken" } }, 409);
        throw error;
      }
    },
  );
}
