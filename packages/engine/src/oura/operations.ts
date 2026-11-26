import { z as zod } from "zod";
import { emptyInput } from "../auth/routes.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { backfillOura } from "./backfill.ts";
import { readOuraConnection } from "./connections.ts";
import { createOura } from "./service.ts";

export const ouraOperations = [
  defineOperation({
    name: "connect_oura",
    method: "POST",
    path: "/api/oura/connect",
    modes: ["access", "fallback"],
    callerClass: "browser",
    admin: false,
    bodyLimit: 1024,
    input: emptyInput,
    output: zod.strictObject({ authorization_url: zod.string().url() }),
    async handler(_input, context) {
      if (context.credential !== "access" && context.credential !== "session")
        throw new OperationError(403, "forbidden");
      return {
        status: 200,
        body: {
          authorization_url: await (
            context.oura ?? createOura(context)
          ).connect(operationPerson(context).id),
        },
      };
    },
  }),
  defineOperation({
    name: "read_oura_connection",
    method: "GET",
    path: "/api/oura",
    modes: ["access", "fallback"],
    callerClass: "browser",
    admin: false,
    input: emptyInput,
    output: zod.strictObject({
      configured: zod.boolean(),
      status: zod
        .enum(["connected", "reconnect_required", "membership_required"])
        .nullable(),
      credentials: zod.enum(["readable", "unreadable"]).nullable(),
      reconnect_required: zod.boolean(),
      scopes: zod.array(zod.string()),
      scope_source: zod.enum(["requested", "response"]).nullable(),
      access_expires_at: zod.string().nullable(),
      last_synced_at: zod.string().nullable(),
    }),
    handler(_input, context) {
      return {
        status: 200,
        body: readOuraConnection(
          context.database,
          operationPerson(context).id,
          context.config.ouraTokenKey,
          context.config.oura !== null,
        ),
      };
    },
  }),
  defineOperation({
    name: "oura_backfill",
    description:
      "One-off import of older Oura history: fetches only sleep, HRV, resting heart rate and readiness from since (YYYY-MM-DD) up to the earliest day Tare already holds. Activity, workouts and stress are not fetched. Running it again changes nothing.",
    method: "POST",
    path: "/api/oura/backfill",
    modes: ["access", "fallback"],
    callerClass: "browser_and_agent",
    admin: false,
    bodyLimit: 1024,
    input: zod.strictObject({ since: zod.iso.date() }),
    output: zod.strictObject({
      days_written: zod.number().int().nonnegative(),
      first_day: zod.iso.date().nullable(),
      last_day: zod.iso.date().nullable(),
    }),
    async handler(input, context) {
      return {
        status: 200,
        body: await backfillOura({
          database: context.database,
          oura: context.oura ?? createOura(context),
          clock: context.clock,
          person: operationPerson(context),
          since: input.since,
        }),
      };
    },
  }),
];
