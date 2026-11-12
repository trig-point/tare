import { z as zod } from "zod";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { pantryOutput } from "./service.ts";

export const pantryOperations = [
  { name: "list_pantry", method: "GET", path: "/api/pantry" },
  { name: "refresh_pantry", method: "POST", path: "/api/pantry/refresh" },
  {
    name: "reset_pantry_connection",
    method: "POST",
    path: "/api/pantry/connection/reset",
  },
].map(({ name, method, path }) =>
  defineOperation({
    name,
    method: method as "GET" | "POST",
    path,
    modes: ["access", "fallback"],
    callerClass: "browser_and_agent",
    admin: false,
    ...(method === "POST" ? { bodyLimit: 1024 } : {}),
    input: zod.strictObject(
      name === "reset_pantry_connection"
        ? { replaced: zod.boolean().optional() }
        : {},
    ),
    output: pantryOutput,
    async handler(input, context) {
      const userId = operationPerson(context).id;
      const service = context.pantry;
      if (!service) {
        if (context.config.grocy)
          throw new OperationError(503, "pantry_unavailable");
        return {
          status: 200,
          body: {
            state: "disabled",
            generation: null,
            fetch_started_at: null,
            last_success_at: null,
            stale: true,
            error: null,
            products: [],
          },
        };
      }
      const body =
        name === "list_pantry"
          ? service.read(userId)
          : name === "refresh_pantry"
            ? await service.refresh(userId)
            : service.reset(
                userId,
                "replaced" in input && input.replaced === true,
              );
      return { status: 200, body };
    },
  }),
);
