import type { Database } from "better-sqlite3";
import type { JWTVerifyGetKey } from "jose";
import { z as zod } from "zod";
import type { CalendarRefresher } from "../calendar/refresh.ts";
import { type Config, validateTimezone } from "../config.ts";
import type { LookupAdapters } from "../lookup/index.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import type { OuraService } from "../oura/service.ts";
import type { PantryService } from "../pantry/service.ts";
import { deleteSession } from "../queries/delete-session.ts";
import { insertAccount } from "../queries/insert-account.ts";
import { selectUserByUsername } from "../queries/select-user-by-username.ts";
import { updateDaySettings } from "../queries/update-day-settings.ts";
import type { QuestionKind } from "../questions/kinds.ts";
import { normalizeAccessEmail } from "./access.ts";
import {
  hashPassword,
  isValidPassword,
  PASSWORD_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
} from "./password.ts";
import { createSession, hashToken } from "./sessions.ts";

export interface AppOptions {
  pantry?: PantryService;
  database: Database;
  config: Config;
  clock: { now(): Date };
  dummyHash: string;
  accessKeySet?: JWTVerifyGetKey;
  questionKinds?: ReadonlyMap<string, QuestionKind>;
  lookup?: LookupAdapters;
  oura?: OuraService;
  calendar?: CalendarRefresher;
  homeAssistant?: { refreshAll(): void };
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
    name: "open_sign_in",
    method: "GET",
    path: "/api/sign-in",
    callerClass: "public",
    output: zod.never(),
    handler: () => ({ status: 302 }),
  }),
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
    name: "save_day_settings",
    method: "PATCH",
    path: "/api/me",
    bodyLimit: 8192,
    input: zod.strictObject({
      timezone: zod.string().trim().min(1).max(64),
      day_start_hour: zod.number().int().min(0).max(23),
    }),
    output: userOutput,
    handler(body, context) {
      try {
        validateTimezone(body.timezone);
      } catch {
        throw new OperationError(400, "invalid_request");
      }
      const [person] = updateDaySettings(context.database, body, {
        id: operationPerson(context).id,
      });
      if (!person) throw new Error("Day settings save returned no row");
      context.calendar?.enqueue(person.id);
      return { status: 200, body: { user: toPublicUser(person) } };
    },
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
    name: "sign_in",
    method: "POST",
    path: "/api/session",
    modes: ["fallback"],
    callerClass: "public",
    bodyLimit: 8192,
    input: zod.object({
      username: zod.string().trim().min(1).max(USERNAME_MAX_LENGTH),
      password: zod.string().min(1).max(PASSWORD_MAX_LENGTH),
    }),
    output: userOutput,
    async handler(body, context) {
      const {
        database,
        config,
        clock,
        dummyHash,
        verifyPassword,
        signInLimiter,
      } = context;
      if (signInLimiter.waiting >= 8)
        throw new OperationError(503, "busy", { "Retry-After": "1" });
      signInLimiter.waiting++;
      try {
        const person = selectUserByUsername(database, {
          username: body.username,
        });
        if (!person || person.password_hash === null) {
          await verifyPassword(body.password, dummyHash);
          throw new OperationError(401, "invalid_credentials");
        }
        if (!(await verifyPassword(body.password, person.password_hash)))
          throw new OperationError(401, "invalid_credentials");
        const token = createSession(
          database,
          person.id,
          context.sessionToken,
          clock.now(),
          config.sessionDays,
        );
        return {
          status: 200,
          body: { user: toPublicUser(person) },
          effects: { setSessionCookie: token },
        };
      } finally {
        signInLimiter.waiting--;
      }
    },
  }),
  defineOperation({
    ...browserOperation,
    name: "sign_out",
    method: "DELETE",
    path: "/api/session",
    modes: ["fallback"],
    output: zod.never(),
    handler(_input, context) {
      if (context.sessionToken === undefined)
        throw new Error("Authenticated session cookie missing");
      deleteSession(context.database, {
        token_hash: hashToken(context.sessionToken),
      });
      return { status: 204, effects: { clearSessionCookie: true } };
    },
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
