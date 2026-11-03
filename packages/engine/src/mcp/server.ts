import { randomUUID } from "node:crypto";
import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { AuthEnv } from "../auth/middleware.ts";
import { agentOperationsFor } from "../operations/index.ts";
import {
  executeOperation,
  type OperationDependencies,
  OperationError,
  type OperationIdentity,
} from "../operations/registry.ts";

interface McpSession {
  ownerPersonId: number;
  transport: StreamableHTTPTransport;
  server: McpServer;
  identity: OperationIdentity;
  lastSeenAt: number;
}

const idleLifetime = 60 * 60 * 1000;
const sessionsPerPerson = 8;

export function mountMcp(app: Hono<AuthEnv>, deps: OperationDependencies) {
  const sessions = new Map<string, McpSession>();
  async function closeSession(id: string) {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    await session.transport.close();
    await session.server.close();
  }

  async function createSession(identity: OperationIdentity, now: number) {
    for (const [id, session] of sessions)
      if (now - session.lastSeenAt >= idleLifetime) await closeSession(id);
    const ownerPersonId = identity.person?.id;
    if (ownerPersonId === undefined)
      throw new OperationError(401, "unauthenticated");
    const owned = [...sessions].filter(
      ([, session]) => session.ownerPersonId === ownerPersonId,
    );
    owned.sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt);
    while (owned.length >= sessionsPerPerson) {
      const oldest = owned.shift();
      if (oldest) await closeSession(oldest[0]);
    }
    const server = new McpServer({ name: "tare", version: "1.0.0" });
    const transport = new StreamableHTTPTransport({
      sessionIdGenerator: randomUUID,
      enableJsonResponse: true,
      enableDnsRebindingProtection: false,
      onsessioninitialized: (id) => {
        sessions.set(id, session);
      },
      onsessionclosed: closeSession,
    });
    const session: McpSession = {
      ownerPersonId,
      transport,
      server,
      identity,
      lastSeenAt: now,
    };
    for (const operation of agentOperationsFor("access")) {
      server.registerTool(
        operation.name,
        { inputSchema: operation.input, outputSchema: operation.output },
        async (input) => {
          try {
            const { body } = await executeOperation(
              operation,
              input,
              session.identity,
              deps,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(body) }],
              structuredContent: body as Record<string, unknown>,
            };
          } catch (error) {
            const code =
              error instanceof OperationError ? error.code : "internal";
            if (!(error instanceof OperationError))
              console.error(
                "mcp_tool_failed",
                error instanceof Error ? error.name : "UnknownError",
                operation.name,
              );
            return {
              isError: true,
              content: [
                { type: "text", text: JSON.stringify({ error: { code } }) },
              ],
            };
          }
        },
      );
    }
    await server.connect(transport);
    return session;
  }

  app.on(
    ["GET", "POST", "DELETE"],
    "/mcp",
    async (context, next) => {
      context.header("Cache-Control", "no-store");
      const origin = context.req.header("Origin");
      if (
        origin !== undefined &&
        !deps.config.mcpAllowedOrigins.includes(origin)
      )
        return context.json({ error: { code: "origin_not_allowed" } }, 403);
      if (context.get("credential") !== "service")
        return context.json({ error: { code: "forbidden" } }, 403);
      await next();
    },
    bodyLimit({
      maxSize: 65_536,
      onError: (context) =>
        context.json({ error: { code: "body_too_large" } }, 413),
    }),
    async (context) => {
      const identity: OperationIdentity = {
        person: context.get("person"),
        credential: context.get("credential"),
      };
      const id = context.req.header("mcp-session-id");
      let session = id === undefined ? undefined : sessions.get(id);
      if (id !== undefined && !session)
        return context.json({ error: { code: "not_found" } }, 404);
      if (session && session.ownerPersonId !== identity.person?.id)
        return context.json({ error: { code: "forbidden" } }, 403);
      const now = deps.clock.now().getTime();
      if (!session) {
        if (context.req.method !== "POST")
          return context.json({ error: { code: "not_found" } }, 404);
        session = await createSession(identity, now);
      }
      session.identity = identity;
      session.lastSeenAt = now;
      let response: Response | undefined;
      try {
        response = await session.transport.handleRequest(context);
      } catch (error) {
        if (!(error instanceof HTTPException)) throw error;
        response = error.getResponse();
      } finally {
        if (session.transport.sessionId === undefined) {
          await session.transport.close();
          await session.server.close();
        }
      }
      // The transport's SSE helper sets no-cache, which still permits storage.
      response?.headers.set("Cache-Control", "no-store");
      return response;
    },
  );
}
