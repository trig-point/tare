import { z as zod } from "zod";
import { emptyInput } from "../auth/routes.ts";
import { defineOperation, operationPerson } from "../operations/registry.ts";
import { readOuraConnection } from "./connections.ts";

export const ouraOperations = [
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
];
