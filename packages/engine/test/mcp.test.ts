import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z as zod } from "zod";
import { operations } from "../src/operations/index.ts";
import { OperationError } from "../src/operations/registry.ts";
import { insertAgentToken } from "../src/queries/insert-agent-token.ts";
import * as auth from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const rpc = (method: string, params = {}) =>
  JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
const list = rpc("tools/list");
const call = (name = "whoami", args = {}) =>
  rpc("tools/call", { name, arguments: args });
const parse = async (response: Response) =>
  JSON.parse((await response.text()).split("data: ").at(-1) ?? "");
async function setupMcp(context: TestContext) {
  const setup = await twoUsers(context, "access");
  const agents: Record<string, string>[] = [];
  for (const [index, person] of [setup.admin, setup.member].entries()) {
    const clientId = `invented-mcp-${index}`;
    insertAgentToken(setup.database, {
      client_id: clientId,
      user_id: person.user.id,
      name: "Example agent",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const payload = { sub: "", common_name: clientId, exp: 1767398400 };
    agents.push(auth.assertionHeader(await auth.signAccessToken(payload)));
  }
  const request = (body = list, id = "", init: RequestInit = {}) =>
    setup.app.request("/mcp", {
      method: "POST",
      body: init.method === "DELETE" ? undefined : body,
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(agents[0])),
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-11-25",
        ...(id ? { "mcp-session-id": id } : {}),
        ...Object.fromEntries(new Headers(init.headers)),
      },
    });
  const result = async (body: string, id: string) =>
    (await parse(await request(body, id))).result;
  const initialize = async () => {
    const params = {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "example", version: "1.0.0" },
    };
    const response = await request(rpc("initialize", params));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const id = response.headers.get("mcp-session-id");
    assert.ok(id);
    await response.text();
    const notification =
      '{"jsonrpc":"2.0","method":"notifications/initialized"}';
    assert.equal((await request(notification, id)).status, 202);
    return id;
  };
  return { ...setup, agents, request, result, initialize };
}

test("MCP HTTP boundary enforces Access, Origin, body size and protocol errors", async (context) => {
  const setup = await setupMcp(context);
  const { request, agents, app, admin } = setup;
  const id = await setup.initialize();
  const origin = "https://allowed.example.test";
  auth.accessConfig.mcpAllowedOrigins.push(origin);
  context.after(() => {
    auth.accessConfig.mcpAllowedOrigins.length = 0;
  });
  const post = { method: "POST", body: "{" };
  const foreign = { headers: { Origin: "https://foreign.example.test" } };
  const allowed = { headers: { Origin: origin } };
  const other = { headers: agents[1] };
  const otherEnd = { ...other, method: "DELETE" };
  for (const [send, status, code] of [
    [() => app.request("/mcp", post), 401, "unauthenticated"],
    [() => admin.request("/mcp", post), 403, "forbidden"],
    [() => request("{", id, foreign), 403, "origin_not_allowed"],
    [() => request(list, id), 200, undefined],
    [() => request(list, id, allowed), 200, undefined],
    [() => auth.fixture(context).app.request("/mcp", post), 404, "not_found"],
    [() => request("x".repeat(65_537), id), 413, "body_too_large"],
    [() => request("{", id), 400, -32700],
    [() => request(call(), id, other), 403, "forbidden"],
    [() => request(list, id, otherEnd), 403, "forbidden"],
  ] as const) {
    const actual = await send();
    assert.equal(actual.status, status);
    assert.equal((await parse(actual)).error?.code, code);
  }
});

test("MCP tools match registry schemas and routes and act for their person", async (context) => {
  const setup = await setupMcp(context);
  const { app, result, initialize } = setup;
  const id = await initialize();
  const expected = operations.filter(
    (operation) =>
      operation.callerClass === "browser_and_agent" &&
      operation.modes.includes("access"),
  );
  const tools: Tool[] = (await result(list, id)).tools;
  for (const name of ["plan_slot", "read_plan"]) {
    const tool = tools.find((tool) => tool.name === name);
    assert.equal(tool?.inputSchema.type, "object");
    assert.ok(tool?.outputSchema?.properties);
    if (name === "plan_slot") assert.ok(tool.inputSchema.properties?.position);
  }
  const paths = app.routes.map((route) => `${route.method} ${route.path}`);
  assert.deepEqual(
    tools.map((tool) => tool.name),
    expected.map((operation) => operation.name),
  );
  for (const operation of expected) {
    const tool = tools.find((tool) => tool.name === operation.name);
    for (const io of ["input", "output"] as const) {
      const options = { target: "draft-7", io } as const;
      const schema = zod.toJSONSchema(operation[io], options);
      assert.deepEqual(tool?.[`${io}Schema`], schema);
    }
  }
  for (const operation of operations)
    if (operation.modes.includes("access"))
      assert.ok(paths.includes(`${operation.method} ${operation.path}`));
  const { structuredContent, content } = await result(call(), id);
  assert.deepEqual(structuredContent, { user: setup.admin.user });
  assert.equal(content[0].text, JSON.stringify(structuredContent));
  assert.equal((await result(call("create_agent_token"), id)).isError, true);
  const invalid = await result(call("whoami", { extra: true }), id);
  assert.equal(invalid.isError, true);
});

test("MCP tool errors preserve operation codes and redact unexpected failures", async (context) => {
  const setup = await setupMcp(context);
  const id = await setup.initialize();
  const whoami = operations.find((operation) => operation.name === "whoami");
  assert.ok(whoami);
  const logged = context.mock.method(console, "error", () => {});
  for (const [error, code] of [
    [new OperationError(403, "forbidden"), "forbidden"],
    [new Error("private-sentinel"), "internal"],
  ] as const) {
    const handler = context.mock.method(whoami, "handler", () => {
      throw error;
    });
    const result = await setup.result(call(), id);
    assert.equal(result.isError, true);
    assert.deepEqual(JSON.parse(result.content[0].text), { error: { code } });
    assert.equal(JSON.stringify(result).includes("private-sentinel"), false);
    handler.mock.restore();
  }
  const messages = logged.mock.calls.map((call) => call.arguments);
  assert.deepEqual(messages, [["mcp_tool_failed", "Error", "whoami"]]);
});

test("MCP DELETE, idle expiry and the ninth session remove stored sessions", async (context) => {
  const setup = await setupMcp(context);
  const { initialize, request } = setup;
  const end = { method: "DELETE" };
  const deleted = await initialize();
  assert.equal((await request(list, deleted, end)).status, 200);
  assert.equal((await request(list, deleted)).status, 404);
  const idle = await initialize();
  setup.setNow("2026-01-01T01:00:00.000Z");
  const ids = [await initialize()];
  assert.equal((await request(list, idle)).status, 404);
  for (let index = 1; index < 8; index++) {
    setup.setNow(`2026-01-01T01:00:0${index}.000Z`);
    ids.push(await initialize());
  }
  setup.setNow("2026-01-01T01:00:08.000Z");
  assert.equal((await request(list, ids[0])).status, 200);
  ids.push(await initialize());
  assert.equal((await request(list, ids[1])).status, 404);
  for (const id of ids.filter((_sessionId, index) => index !== 1)) {
    assert.equal((await request(list, id, end)).status, 200);
  }
});
