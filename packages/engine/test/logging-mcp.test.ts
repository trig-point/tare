import assert from "node:assert/strict";
import { insertAgentToken } from "../src/queries/insert-agent-token.ts";
import { assertionHeader, signAccessToken } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

test("MCP logs and edits intake and weights", async (context) => {
  const setup = await twoUsers(context, "access");
  insertAgentToken(setup.database, {
    client_id: "example-logger",
    user_id: setup.admin.user.id,
    name: "Example",
    created_at: "2026-01-01T00:00:00.000Z",
  });
  const headers = {
    ...assertionHeader(
      await signAccessToken({ sub: "", common_name: "example-logger" }),
    ),
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  let session = "";
  const rpc = async (method: string, params: unknown) => {
    const response = await setup.app.request("/mcp", {
      method: "POST",
      headers: {
        ...headers,
        ...(session ? { "mcp-session-id": session } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    session = response.headers.get("mcp-session-id") ?? session;
    assert.equal(response.status, 200);
    return JSON.parse((await response.text()).split("data: ").at(-1) ?? "")
      .result;
  };
  await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "Example", version: "1" },
  });
  const tools = (await rpc("tools/list", {})).tools;
  const food = tools.find((tool: { name: string }) => tool.name === "log_food");
  assert.match(food.description, /omit servings/);
  assert.ok(food.inputSchema.properties.client_id);
  assert.ok(food.inputSchema.properties.source_food_id);
  const call = async (name: string, args: unknown) => {
    const result = await rpc("tools/call", { name, arguments: args });
    assert.equal(result.isError, undefined);
    return result.structuredContent;
  };
  for (const [input, message] of [
    [
      { name: "Example", kcal: 100, servings: 1 },
      "Servings needs a food reference",
    ],
    [
      { food_id: 1, servings: 1, name: "Example" },
      "A food reference takes no name, source or nutrients",
    ],
    [
      { name: "Example" },
      "Ad hoc food needs a name and one of kcal, protein, carbs, fat or fiber",
    ],
  ] as const) {
    const result = await rpc("tools/call", {
      name: "log_food",
      arguments: { client_id: "bad", ...input },
    });
    assert.equal(result.isError, true);
    assert.ok(
      result.content.some((item: { text: string }) =>
        item.text.includes(message),
      ),
    );
  }
  const logged = await call("log_food", {
    client_id: "mcp",
    name: "Example soup",
    kcal: 120,
  });
  assert.equal(logged.created, true);
  const edited = await call("edit_intake", {
    id: logged.entry.id,
    portion_note: "Warm",
  });
  assert.equal(edited.entry.portion_note, "Warm");
  assert.deepEqual(await call("delete_intake", { id: logged.entry.id }), {
    deleted: true,
    id: logged.entry.id,
  });
  const weight = await call("log_weight", {
    client_id: "mcp-weight",
    weight_kg: 70,
    note: "clothed",
  });
  assert.equal(weight.entry.note, "clothed");
  const today = await setup.admin.request("/api/today");
  assert.equal(today.status, 200);
  assert.equal((await today.json()).weights[0].note, "clothed");
  assert.equal((await call("weight_history", {})).readings[0].note, "clothed");
  for (const [patch, note] of [
    [{ note: "before breakfast" }, "before breakfast"],
    [{ weight_kg: 71 }, "before breakfast"],
    [{ note: null }, null],
  ] as const) {
    const editedWeight = await call("edit_weight", {
      id: weight.entry.id,
      ...patch,
    });
    assert.equal(editedWeight.entry.note, note);
    assert.equal((await call("today", {})).weights[0].note, note);
  }
  for (const note of ["n".repeat(201), "\0", "\ud800"]) {
    const response = await setup.admin.request("/api/weights", {
      method: "POST",
      body: JSON.stringify({ client_id: "invalid-note", weight_kg: 70, note }),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(
    (await call("log_weight", { client_id: "no-note", weight_kg: 70 })).entry
      .note,
    null,
  );
});
