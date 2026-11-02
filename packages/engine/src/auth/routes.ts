import type { Database } from "better-sqlite3";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { JWTVerifyGetKey } from "jose";
import { z as zod } from "zod";
import { type Config, validateTimezone } from "../config.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { deleteSession } from "../queries/delete-session.ts";
import { insertAccount } from "../queries/insert-account.ts";
import { selectUserByUsername } from "../queries/select-user-by-username.ts";
import { normalizeAccessEmail } from "./access.ts";
import {
  type AuthEnv,
  hasRequestedWith,
  requireRequestedWith,
  sessionAuth,
} from "./middleware.ts";
import {
  hashPassword,
  isValidPassword,
  normalizeUsername,
  USERNAME_MAX_LENGTH,
} from "./password.ts";
import { createSession, hashToken } from "./sessions.ts";

export interface AppOptions {
  database: Database;
  config: Config;
  clock: { now(): Date };
  dummyHash: string;
  accessKeySet?: JWTVerifyGetKey;
  verifyPassword(password: string, stored: string): Promise<boolean>;
}

export function toPublicUser(person: {
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
    if (username === null) return null;
    return {
      username,
      password: fields.password,
      email: fields.email,
      timezone: fields.timezone,
    };
  } catch {
    return null;
  }
}

export const emptyInput = zod.strictObject({});
export const publicUserOutput = zod.strictObject({
  id: zod.number(),
  username: zod.string(),
  timezone: zod.string(),
  day_start_hour: zod.number(),
  is_admin: zod.boolean(),
});
const userOutput = zod.strictObject({ user: publicUserOutput });
const browserOperation = {
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser" as const,
  admin: false,
  input: emptyInput,
};

export const authOperations = [
  defineOperation({
    ...browserOperation,
    name: "whoami",
    method: "GET",
    path: "/api/me",
    callerClass: "browser_and_agent",
    output: userOutput,
    handler: (_input, identity) => ({
      status: 200,
      body: { user: toPublicUser(operationPerson(identity)) },
    }),
  }),
  defineOperation({
    ...browserOperation,
    name: "session_check",
    method: "GET",
    path: "/api/session",
    output: zod.union([
      userOutput.extend({ mode: zod.literal("fallback") }),
      userOutput.extend({
        mode: zod.literal("access"),
        logout_url: zod.string(),
      }),
    ]),
    handler: (_input, identity) => ({
      status: 200,
      body: {
        user: toPublicUser(operationPerson(identity)),
        ...(identity.config.identity.mode === "access"
          ? {
              mode: "access",
              logout_url: `${identity.config.identity.teamDomain}/cdn-cgi/access/logout`,
            }
          : { mode: "fallback" }),
      },
    }),
  }),
  defineOperation({
    ...browserOperation,
    name: "add_user",
    method: "POST",
    path: "/api/users",
    admin: true,
    bodyLimit: 8192,
    input: zod.object({
      username: zod.string().trim().min(1).max(USERNAME_MAX_LENGTH),
      password: zod.unknown().optional(),
      email: zod.unknown().optional(),
      timezone: zod.string().optional(),
    }),
    output: userOutput,
    async handler(body, context) {
      const { database, config, clock } = context;
      let timezone: string;
      try {
        timezone = validateTimezone(
          body.timezone ?? operationPerson(context).timezone,
        );
      } catch {
        throw new OperationError(400, "invalid_request");
      }
      let accessEmail: string | null = null;
      let passwordHash: string | null = null;
      if (config.identity.mode === "access") {
        if (typeof body.email !== "string")
          throw new OperationError(400, "invalid_request");
        accessEmail = normalizeAccessEmail(body.email);
        if (accessEmail === null || accessEmail.length > 320)
          throw new OperationError(400, "invalid_request");
      } else {
        if (!isValidPassword(body.password))
          throw new OperationError(400, "invalid_request");
        passwordHash = await hashPassword(body.password);
      }
      try {
        const person = insertAccount(database, {
          username: body.username,
          password_hash: passwordHash,
          access_email: accessEmail,
          timezone,
          is_admin: 0,
          created_at: clock.now().toISOString(),
        });
        if (!person) throw new Error("Could not create user");
        return { status: 201, body: { user: toPublicUser(person) } };
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "SQLITE_CONSTRAINT_UNIQUE"
        ) {
          if (error.message === "UNIQUE constraint failed: users.access_email")
            throw new OperationError(409, "email_taken");
          if (error.message === "UNIQUE constraint failed: users.username")
            throw new OperationError(409, "username_taken");
        }
        throw error;
      }
    },
  }),
];

export function mountAuthRoutes(app: Hono<AuthEnv>, options: AppOptions) {
  const { database, config, clock, dummyHash, verifyPassword } = options;
  if (config.identity.mode === "access") return;
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
      if (!body || !isValidPassword(body.password))
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
        if (!person || person.password_hash === null) {
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

  app.delete("/api/session", authenticate, requireRequestedWith, (context) => {
    const token = getCookie(context, "tare_session");
    if (token === undefined)
      throw new Error("Authenticated session cookie missing");
    deleteSession(database, { token_hash: hashToken(token) });
    deleteCookie(context, "tare_session", cookieOptions);
    return context.body(null, 204);
  });
}
