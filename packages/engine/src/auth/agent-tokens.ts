import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { deleteAgentToken } from "../queries/delete-agent-token.ts";
import { insertAgentToken } from "../queries/insert-agent-token.ts";
import { selectAgentTokens } from "../queries/select-agent-tokens.ts";
import { selectUser } from "../queries/select-user.ts";
import {
  type AuthEnv,
  authenticatedPerson,
  currentPerson,
  requireAdmin,
  requireRequestedWith,
} from "./middleware.ts";
import type { AppOptions } from "./routes.ts";

const mappingBody = z.object({
  client_id: z.string().trim().min(1).max(256),
  user_id: z.number().int().positive(),
  name: z.string().trim().min(1).max(64),
});

export function mountAgentTokenRoutes(app: Hono<AuthEnv>, options: AppOptions) {
  const { database, clock } = options;
  app.post(
    "/api/agent-tokens",
    authenticatedPerson,
    requireRequestedWith,
    requireAdmin(database),
    bodyLimit({
      maxSize: 8192,
      onError: (context) =>
        context.json({ error: { code: "body_too_large" } }, 413),
    }),
    async (context) => {
      const body = mappingBody.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!body.success || !selectUser(database, { id: body.data.user_id }))
        return context.json({ error: { code: "invalid_request" } }, 400);
      try {
        const mapping = insertAgentToken(database, {
          ...body.data,
          created_at: clock.now().toISOString(),
        });
        if (!mapping) throw new Error("Could not create agent mapping");
        return context.json({ agent_token: mapping }, 201);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "SQLITE_CONSTRAINT_UNIQUE" &&
          error.message === "UNIQUE constraint failed: agent_tokens.client_id"
        )
          return context.json({ error: { code: "client_id_taken" } }, 409);
        throw error;
      }
    },
  );
  app.get("/api/agent-tokens", authenticatedPerson, (context) =>
    context.json({
      agent_tokens: selectAgentTokens(database, {
        user_id: currentPerson(context).id,
      }),
    }),
  );
  app.delete(
    "/api/agent-tokens/:id",
    authenticatedPerson,
    requireRequestedWith,
    (context) => {
      const id = Number(context.req.param("id"));
      if (
        !Number.isSafeInteger(id) ||
        id < 1 ||
        deleteAgentToken(database, { user_id: currentPerson(context).id, id })
          .length === 0
      )
        return context.json({ error: { code: "not_found" } }, 404);
      return context.body(null, 204);
    },
  );
}
