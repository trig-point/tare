import { randomBytes } from "node:crypto";
import { z as zod } from "zod";
import { emptyInput } from "../auth/routes.ts";
import { hashToken } from "../auth/sessions.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { insertInboundToken } from "../queries/insert-inbound-token.ts";
import { rotateInboundToken } from "../queries/rotate-inbound-token.ts";

export const inboundTokenOperations = [false, true].map((rotate) =>
  defineOperation({
    name: rotate ? "rotate_inbound_token" : "create_inbound_token",
    method: "POST",
    path: rotate ? "/api/inbound-token/rotate" : "/api/inbound-token",
    modes: ["access", "fallback"],
    callerClass: "browser",
    admin: false,
    bodyLimit: 8192,
    input: emptyInput,
    output: zod.strictObject({ token: zod.string() }),
    handler(_input, context) {
      const token = randomBytes(32).toString("base64url");
      const parameters = {
        user_id: operationPerson(context).id,
        token_hash: hashToken(token),
        created_at: context.clock.now().toISOString(),
      };
      const result = rotate
        ? rotateInboundToken(context.database, parameters, {
            user_id: parameters.user_id,
          })[0]
        : insertInboundToken(context.database, parameters);
      if (!result)
        throw new OperationError(
          rotate ? 404 : 409,
          rotate ? "token_missing" : "token_exists",
        );
      return { status: 201, body: { token } };
    },
  }),
);
