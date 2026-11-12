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
import { isPantryOperation } from "../pantry/egress.ts";

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

  // Synchronous from insert to the last delete, so parallel opens cannot pass the cap.
  async function admitSession(id: string, admitted: McpSession) {
    sessions.set(id, admitted);
    const all = [...sessions].sort(
      (left, right) => left[1].lastSeenAt - right[1].lastSeenAt,
    );
    const owned = all.filter(
      ([, session]) => session.ownerPersonId === admitted.ownerPersonId,
    );
    const evicted = [
      ...all.filter(
        ([, session]) =>
          admitted.lastSeenAt - session.lastSeenAt >= idleLifetime,
      ),
      ...owned.slice(0, Math.max(0, owned.length - sessionsPerPerson)),
    ];
    await Promise.all(evicted.map(([evictedId]) => closeSession(evictedId)));
  }

  async function createSession(identity: OperationIdentity, now: number) {
    const ownerPersonId = identity.person?.id;
    if (ownerPersonId === undefined)
      throw new OperationError(401, "unauthenticated");
    const server = new McpServer({ name: "tare", version: "1.0.0" });
    const transport = new StreamableHTTPTransport({
      sessionIdGenerator: randomUUID,
      // @hono/mcp 0.3.5 never frees request state in JSON-response mode.
      enableDnsRebindingProtection: false,
      onsessioninitialized: (id) => admitSession(id, session),
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
        {
          description: operation.description,
          inputSchema: operation.input,
          outputSchema: operation.output,
        },
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
            if (
              !(error instanceof OperationError) &&
              !isPantryOperation(operation.name)
            )
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
