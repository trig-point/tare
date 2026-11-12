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
import { disabledStock } from "./support/stock.ts";
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
      stock: disabledStock,
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
        catalog: async () => ({
          status: "ok",
          value: [
            { id: 1, name: "Synthetic item", qu_id_stock: 1, active: 1 },
            { id: 2, name: "Synthetic item", qu_id_stock: 1, active: 1 },
          ],
        }),
        barcodes: async () => ({ status: "ok", value: [] }),
        product: async (_owner, productId) => ({
          status: "ok",
          value: {
            product: {
              id: productId,
              name: "Synthetic lentils",
              qu_id_stock: 1,
              enable_tare_weight_handling: 0,
            },
            quantity_unit_stock: { id: 1, name: "can", name_plural: null },
          },
        }),
        recipes: async () => ({
          status: "ok",
          value: [
            {
              id: 1,
              name: "Synthetic soup",
              type: "normal",
              desired_servings: 2,
            },
          ],
        }),
        recipePositions: async () => ({ status: "ok", value: [] }),
        fulfillment: async () => ({
          status: "ok",
          value: [
            {
              recipe_id: 1,
              need_fulfilled: 1,
              need_fulfilled_with_shopping_list: 1,
            },
          ],
        }),
        units: async () => ({ status: "ok", value: [] }),
        conversions: async () => ({ status: "ok", value: [] }),
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
    const decision = JSON.stringify({
      request_id: "00000000-0000-4000-8000-000000000000",
      attempt_number: 0,
      mutation_id: "synthetic-decision",
      decision: "abandoned",
    });
    for (const [path, body] of [
      ["/api/pantry/requests", undefined],
      ["/api/pantry/requests/reconcile", decision],
    ] as const) {
      const method = body ? "POST" : "GET";
      const refused = await setup.member.request(path, { method, body });
      const answered = await setup.admin.request(path, { method, body });
      assert.deepEqual(
        [refused.status, answered.status, await answered.text()],
        body
          ? [403, 404, '{"error":{"code":"pantry_request_not_found"}}']
          : [403, 200, '{"state":"ready","unresolved":[],"history":[]}'],
      );
    }
    const addFood = (userId: number) =>
      Number(
        setup.database
          .prepare(
            "INSERT INTO foods (user_id, name, provenance) VALUES (?, 'Synthetic stew', 'label')",
          )
          .run(userId).lastInsertRowid,
      );
    const own = addFood(setup.admin.user.id);
    const theirs = addFood(setup.member.user.id);
    const generation = service.read(setup.admin.user.id).generation;
    const binding = (reference_id: number, change = {}) => ({
      reference_kind: "food",
      reference_id,
      product_id: 1,
      stock_unit_id: 1,
      quantity_per_serving: 1.5,
      expected_generation: generation,
      ...change,
    });
    const link = (reference_id: number) =>
      JSON.stringify({
        recipe_id: 1,
        reference_kind: "food",
        reference_id,
        servings: 1,
      });
    const recipeLink = "/api/pantry/recipes/1/nutrition";
    const proposal = JSON.stringify({
      reference_kind: "food",
      reference_id: own,
    });
    for (const [person, path, method, body, status] of [
      [setup.member, "/api/pantry/bindings/proposal", "POST", proposal, 403],
      [setup.member, "/api/pantry/bindings", "POST", binding(theirs), 403],
      [setup.member, `/api/pantry/bindings/food/${own}`, "DELETE", null, 403],
      [setup.member, "/api/pantry/recipes", "GET", null, 403],
      [setup.member, "/api/pantry/recipes/nutrition", "POST", link(own), 403],
      [setup.member, recipeLink, "DELETE", null, 403],
      [setup.admin, "/api/pantry/recipes/nutrition", "POST", link(theirs), 404],
      [setup.admin, "/api/pantry/recipes/nutrition", "POST", link(own), 200],
      [setup.admin, "/api/pantry/recipes", "GET", null, 200],
      [setup.admin, recipeLink, "DELETE", null, 200],
      [setup.admin, "/api/pantry/bindings", "POST", binding(theirs), 404],
      [
        setup.admin,
        "/api/pantry/bindings",
        "POST",
        binding(own, { quantity_per_serving: 0 }),
        400,
      ],
      [setup.admin, "/api/pantry/bindings/proposal", "POST", proposal, 200],
      [setup.admin, "/api/pantry/bindings", "POST", binding(own), 200],
    ] as const)
      assert.equal(
        (
          await person.request(path, {
            method,
            body:
              typeof body === "string" || body === null
                ? body
                : JSON.stringify(body),
          })
        ).status,
        status,
      );
    const listed = await (await setup.admin.request("/api/pantry")).json();
    assert.deepEqual(
      listed.bindings.map((row: { reference_id: number; status: string }) => [
        row.reference_id,
        row.status,
      ]),
      [[own, "valid"]],
    );
    const deleted = await setup.admin.request(
      `/api/pantry/bindings/food/${own}`,
      {
        method: "DELETE",
      },
    );
    assert.deepEqual((await deleted.json()).bindings, []);
    connectionConfig.apiKey = "state";
    const withheld = await setup.admin.request("/api/pantry");
    assert.equal(withheld.status, 503);
    assert.equal((await withheld.text()).includes("state"), false);
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
      for (const [name, args] of [
        [
          "propose_pantry_binding",
          { reference_kind: "food", reference_id: own },
        ],
        ["save_pantry_binding", binding(own)],
        [
          "delete_pantry_binding",
          { reference_kind: "food", reference_id: own },
        ],
        ["save_recipe_nutrition_link", JSON.parse(link(own))],
        ["list_pantry_recipes", {}],
        ["delete_recipe_nutrition_link", { recipe_id: 1 }],
      ] as const) {
        const result = await agent.callTool({ name, arguments: args });
        assert.equal(result.isError, undefined);
      }
      let sequence = 0;
      let session: string | null = null;
      const send = (method: string, params: unknown, batch = false) => {
        const request = { jsonrpc: "2.0", id: ++sequence, method, params };
        return setup.app.request("/mcp", {
          method: "POST",
          headers: {
            ...headers,
            ...(session ? { "mcp-session-id": session } : {}),
          },
          body: JSON.stringify(batch ? [request] : request),
        });
      };
      const initialized = await send("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "synthetic", version: "1" },
      });
      session = initialized.headers.get("mcp-session-id");
      assert.ok(session);
      await initialized.text();
      const mixed = await setup.app.request("/mcp", {
        method: "POST",
        headers: { ...headers, "mcp-session-id": session },
        body: JSON.stringify(
          [
            ["save_pantry_binding", binding(own)],
            ["save_pantry_binding", binding(own, { product_id: 2 })],
            ["list_pantry_recipes", {}],
            ["list_pantry_requests", {}],
          ].map(([name, args]) => ({
            jsonrpc: "2.0",
            id: ++sequence,
            method: "tools/call",
            params: { name, arguments: args },
          })),
        ),
      });
      const outcomes = await mixed.text();
      assert.match(outcomes, /"status\\":\\"valid/);
      assert.match(outcomes, /pantry_binding_conflict/);
      assert.match(outcomes, /Synthetic soup/);
      assert.match(outcomes, /\\"unresolved\\":\[\]/);
      connectionConfig.apiKey = "structuredContent";
      for (const batch of [false, true]) {
        const blocked = await send(
          "tools/call",
          { name: "list_pantry", arguments: {} },
          batch,
        );
        assert.equal(await blocked.text(), "");
      }
      const unchanged = await send("tools/call", {
        name: "whoami",
        arguments: {},
      });
      assert.match(await unchanged.text(), /structuredContent/);
    }
  });

test("final HTTP and split SSE frames withhold secrets", async () => {
  for (const key of ["synthetic-secret", 'secret"quote']) {
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
});
