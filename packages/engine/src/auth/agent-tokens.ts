import { z as zod } from "zod";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { deleteAgentToken } from "../queries/delete-agent-token.ts";
import { insertAgentToken } from "../queries/insert-agent-token.ts";
import { selectAgentTokens } from "../queries/select-agent-tokens.ts";
import { selectUser } from "../queries/select-user.ts";
import { emptyInput } from "./routes.ts";

const mappingBody = zod.object({
  client_id: zod.string().trim().min(1).max(256),
  user_id: zod.number().int().positive(),
  name: zod.string().trim().min(1).max(64),
});

const mappingOutput = zod.strictObject({
  id: zod.number(),
  user_id: zod.number(),
  client_id: zod.string(),
  name: zod.string(),
  created_at: zod.string(),
  last_used_at: zod.string().nullable(),
});
const browserOperation = {
  modes: ["access"] as "access"[],
  callerClass: "browser" as const,
  admin: false,
};

export const agentTokenOperations = [
  defineOperation({
    ...browserOperation,
    name: "create_agent_token",
    method: "POST",
    path: "/api/agent-tokens",
    admin: true,
    bodyLimit: 8192,
    input: mappingBody,
    output: zod.strictObject({ agent_token: mappingOutput }),
    async handler(body, { database, clock }) {
      if (!selectUser(database, { id: body.user_id }))
        throw new OperationError(400, "invalid_request");
      try {
        const mapping = insertAgentToken(database, {
          ...body,
          created_at: clock.now().toISOString(),
        });
        if (!mapping) throw new Error("Could not create agent mapping");
        return { status: 201, body: { agent_token: mapping } };
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "SQLITE_CONSTRAINT_UNIQUE" &&
          error.message === "UNIQUE constraint failed: agent_tokens.client_id"
        )
          throw new OperationError(409, "client_id_taken");
        throw error;
      }
    },
  }),
  defineOperation({
    ...browserOperation,
    name: "list_agent_tokens",
    method: "GET",
    path: "/api/agent-tokens",
    noStoreSubpaths: true,
    input: emptyInput,
    output: zod.strictObject({ agent_tokens: zod.array(mappingOutput) }),
    handler: (_input, context) => ({
      status: 200,
      body: {
        agent_tokens: selectAgentTokens(context.database, {
          user_id: operationPerson(context).id,
        }),
      },
    }),
  }),
  defineOperation({
    ...browserOperation,
    name: "delete_agent_token",
    method: "DELETE",
    path: "/api/agent-tokens/:id",
    input: zod.object({
      id: zod
        .string()
        .transform(Number)
        .refine((id) => Number.isSafeInteger(id) && id > 0),
    }),
    inputError: "not_found",
    output: zod.never(),
    handler({ id }, context) {
      if (
        deleteAgentToken(context.database, {
          user_id: operationPerson(context).id,
          id,
        }).length === 0
      )
        throw new OperationError(404, "not_found");
      return { status: 204 };
    },
  }),
];
