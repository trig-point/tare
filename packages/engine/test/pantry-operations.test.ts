import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { guardPantryResponse } from "../src/pantry/egress.ts";
import {
  createPantryService,
  type PantryService,
} from "../src/pantry/service.ts";
import {
  accessConfig,
  assertionHeader,
  credentials,
  mcpSession,
  signAccessToken,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const config = {
  url: "http://grocy/api",
  apiKey: "invented-secret",
  username: credentials.username,
};
for (const mode of ["fallback", "access"] as const)
  test(`pantry HTTP owner checks and reset in ${mode}, enabled injection reaches both fixtures`, async (context) => {
    const connectionConfig = { ...config };
    const pantry = new Proxy({} as PantryService, {
      get: (_target, key) => Reflect.get(service, key),
    });
    const setup = await twoUsers(context, mode, {
      pantry,
      config: {
        ...loadConfig({ DATABASE_URL: ":memory:" }),
        ...(mode === "access" ? accessConfig : {}),
        grocy: connectionConfig,
      },
    });
    let requests = 0;
    const service = createPantryService({
      database: setup.database,
      config: connectionConfig,
      ownerId: setup.admin.user.id,
      clock: { now: () => new Date("2026-01-01T00:00:00Z") },
      client: {
        stock: async () => {
          requests++;
          return { status: "ok", value: [] };
        },
        product: async () => assert.fail("empty stock needs no details"),
      },
    });
    for (const [path, method, body] of [
      ["/api/pantry", "GET", undefined],
      ["/api/pantry/refresh", "POST", "{}"],
      ["/api/pantry/connection/reset", "POST", '{"replaced":true}'],
    ] as const) {
      const beforeRequests = requests;
      assert.equal(
        (await setup.member.request(path, { method, body })).status,
        403,
      );
      assert.equal(requests, beforeRequests);
      const response = await setup.admin.request(path, { method, body });
      assert.equal(response.status, 200);
      assert.equal(
        (await response.json()).state,
        method === "GET"
          ? "never_refreshed"
          : path.endsWith("refresh")
            ? "ready"
            : "never_refreshed",
      );
    }
    assert.equal(
      (
        await setup.admin.request("/api/pantry/connection/reset", {
          method: "POST",
          body: '{"extra":true}',
        })
      ).status,
      400,
    );
    connectionConfig.apiKey = "state";
    const withheld = await setup.admin.request("/api/pantry");
    assert.equal(withheld.status, 503);
    assert.equal((await withheld.text()).includes("state"), false);
    connectionConfig.apiKey = "forbidden";
    assert.equal((await setup.member.request("/api/pantry")).status, 503);
    connectionConfig.apiKey = config.apiKey;
    if (mode === "access") {
      const agent = await mcpSession(context, setup, setup.admin.user.id);
      for (const name of [
        "list_pantry",
        "refresh_pantry",
        "reset_pantry_connection",
      ]) {
        const result = await agent.callTool({ name, arguments: {} });
        assert.equal(result.isError, undefined);
        assert.ok(result.structuredContent);
      }
      const headers = {
        ...assertionHeader(
          await signAccessToken({ sub: "", common_name: "example-agent" }),
        ),
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      };
      let sequence = 0;
      let session: string | null = null;
      const send = (method: string, params: unknown) =>
        setup.app.request("/mcp", {
          method: "POST",
          headers: {
            ...headers,
            ...(session ? { "mcp-session-id": session } : {}),
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: ++sequence,
            method,
            params,
          }),
        });
      const initialized = await send("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "synthetic", version: "1" },
      });
      session = initialized.headers.get("mcp-session-id");
      assert.ok(session);
      await initialized.text();
      connectionConfig.apiKey = "structuredContent";
      const blocked = await send("tools/call", {
        name: "list_pantry",
        arguments: {},
      });
      assert.equal(await blocked.text(), "");
      const batched = await setup.app.request("/mcp", {
        method: "POST",
        headers: { ...headers, "mcp-session-id": session as string },
        body: JSON.stringify([
          {
            jsonrpc: "2.0",
            id: ++sequence,
            method: "tools/call",
            params: { name: "list_pantry", arguments: {} },
          },
        ]),
      });
      assert.equal(await batched.text(), "");
      const unchanged = await send("tools/call", {
        name: "whoami",
        arguments: {},
      });
      assert.match(await unchanged.text(), /structuredContent/);
    }
  });

test("final HTTP and split SSE frames refuse dynamic, fixed and escaped key collisions", async () => {
  for (const key of ["synthetic-secret", "state", 'secret"quote']) {
    const response = await guardPantryResponse(
      Response.json({ state: key }),
      key,
    );
    assert.equal((await response.text()).includes(key), false);
    assert.equal(response.status, 503);
    const frame = `event: message\ndata: ${JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({ state: key }) }] } })}\n\n`;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of [frame.slice(0, 15), frame.slice(15)])
          controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    });
    const guarded = await guardPantryResponse(
      new Response(source, {
        headers: { "content-type": "text/event-stream" },
      }),
      key,
    );
    assert.equal(await guarded.text(), "");
  }
  for (const [body, key, expected] of [
    [{ state: "ready" }, "safe-secret", '{"state":"ready"}'],
    [
      { error: { code: "internal" } },
      "internal",
      '{"error":{"code":"pantry_response_withheld"}}',
    ],
    [{ error: "pantry_response_withheld" }, "error", ""],
  ] as const) {
    const response = await guardPantryResponse(Response.json(body), key);
    assert.equal(await response.text(), expected);
  }
});
