import assert from "node:assert/strict";
import { Hono } from "hono";
import type { AuthEnv } from "../src/auth/middleware.ts";
import { toPublicUser } from "../src/auth/routes.ts";
import { loadConfig } from "../src/config.ts";
import { mountOperations } from "../src/operations/http.ts";
import { agentOperations, operations } from "../src/operations/index.ts";
import {
  defineOperation,
  executeOperation,
  type Operation,
  OperationError,
} from "../src/operations/registry.ts";
import {
  accessConfig,
  accessFixture,
  assertionHeader,
  cookie,
  dummyHash,
  fixture,
  issuedAt,
  rejection,
  requestedWith,
  signAccessToken,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";

const browser = operations.find(
  (operation) => operation.name === "session_check",
);
assert.ok(browser);
const whoami = agentOperations[0];
assert.ok(whoami);
const fallbackConfig = loadConfig({ DATABASE_URL: ":memory:" });
const dependencies = (database: ReturnType<typeof fixture>["database"]) => ({
  database,
  config: fallbackConfig,
  clock: { now: () => issuedAt },
  dummyHash,
  verifyPassword: async () => false,
  signInLimiter: { waiting: 0 },
});

test("registry constrains public and administrator operations and inventories every app route", (context) => {
  assert.deepEqual(
    agentOperations.map((operation) => operation.name),
    [
      "whoami",
      "log_food",
      "edit_intake",
      "log_weight",
      "edit_weight",
      "delete_intake",
      "delete_weight",
      "weight_history",
      "lookup_barcode",
      "search_online",
      "list_questions",
      "answer_question",
    ],
  );
  assert.deepEqual(
    operations
      .filter((operation) => operation.callerClass === "public")
      .map((operation) => operation.name),
    ["sign_in"],
  );
  for (const operation of operations) {
    assert.ok(!operation.admin || operation.callerClass === "browser");
    if (operation.method === "GET")
      assert.deepEqual(operation.input.parse({}), {});
  }
  assert.throws(() => defineOperation({ ...browser, callerClass: "public" }));
  assert.throws(() => defineOperation({ ...whoami, admin: true }));
  for (const mode of ["access", "fallback"] as const) {
    const makeSetup = mode === "access" ? accessFixture : fixture;
    const setup = makeSetup(context);
    const infrastructure = [
      "GET /health",
      ...(mode === "access" ? ["GET /mcp", "POST /mcp", "DELETE /mcp"] : []),
    ];
    const registryApp = new Hono<AuthEnv>();
    mountOperations(registryApp, operations, {
      ...dependencies(setup.database),
      config: mode === "access" ? accessConfig : fallbackConfig,
    });
    // One entry per handler, so a second handler on a registered route counts.
    const inventory = (app: Hono<AuthEnv>) =>
      app.routes
        .filter((route) => route.method !== "ALL" || route.path !== "/*")
        .map((route) => `${route.method} ${route.path}`)
        .sort();
    const assertInventory = (app: Hono<AuthEnv>) => {
      const handMounted = inventory(app).filter((route) =>
        infrastructure.includes(route),
      );
      assert.deepEqual(
        inventory(app),
        [...inventory(registryApp), ...handMounted].sort(),
      );
      assert.deepEqual([...new Set(handMounted)], [...infrastructure].sort());
    };
    assertInventory(setup.app);
    for (const mountExtra of [
      (app: Hono<AuthEnv>) =>
        app.all("/api/extra", (honoContext) => honoContext.body(null)),
      (app: Hono<AuthEnv>) =>
        app.get("/api/me", (honoContext) => honoContext.body(null)),
    ]) {
      const extra = makeSetup(context);
      mountExtra(extra.app);
      assert.throws(() => assertInventory(extra.app));
    }
    assert.throws(() =>
      mountOperations(
        setup.app,
        [browser, browser],
        dependencies(setup.database),
      ),
    );
    assert.throws(() =>
      mountOperations(
        setup.app,
        [browser, { ...browser, name: "duplicate" }],
        dependencies(setup.database),
      ),
    );
  }
});

test("executor enforces the caller-class table and rereads administrator roles", async (context) => {
  const setup = fixture(context);
  const deps = dependencies(setup.database);
  const publicOperation = defineOperation({
    ...whoami,
    name: "sign_in",
    method: "POST",
    path: "/api/session",
    modes: ["fallback"],
    callerClass: "public",
    handler: () => ({
      status: 200,
      body: { user: toPublicUser(setup.admin) },
    }),
  });
  const policyOperations: Operation[] = [publicOperation, browser, whoami];
  for (const [credential, allowed] of [
    [undefined, [true, false, false]],
    ["session", [true, true, true]],
    ["access", [true, true, true]],
    ["service", [true, false, true]],
  ] as const) {
    const identity = {
      credential,
      person: credential ? setup.admin : undefined,
    };
    for (const [index, operation] of policyOperations.entries()) {
      if (allowed[index])
        assert.equal(
          (await executeOperation(operation, {}, identity, deps)).status,
          200,
        );
      else
        await assert.rejects(executeOperation(operation, {}, identity, deps), {
          status: credential ? 403 : 401,
        });
    }
  }
  const adminOperation = { ...browser, admin: true };
  setup.database
    .prepare("UPDATE users SET is_admin = 0 WHERE id = ?")
    .run(setup.admin.id);
  await assert.rejects(
    executeOperation(
      adminOperation,
      {},
      { credential: "session", person: setup.admin },
      deps,
    ),
    { status: 403 },
  );
  await assert.rejects(
    executeOperation(
      browser,
      { owner: setup.admin.id },
      { credential: "session", person: setup.admin },
      deps,
    ),
    { code: "invalid_request" },
  );
});

test("HTTP caller classes, input errors and owner scoping preserve existing routes", async (context) => {
  const fallback = fixture(context);
  const access = accessFixture(context);
  const browserHeaders = assertionHeader(await signAccessToken());
  const userResponse = await access.app.request("/api/users", {
    method: "POST",
    headers: { ...browserHeaders, ...requestedWith },
    body: JSON.stringify({
      username: "second-person",
      email: "second@example.com",
    }),
  });
  assert.equal(userResponse.status, 201);
  const { user } = await userResponse.json();
  const mappingResponse = await access.app.request("/api/agent-tokens", {
    method: "POST",
    headers: { ...browserHeaders, ...requestedWith },
    body: JSON.stringify({
      client_id: "example-service",
      user_id: access.admin.id,
      name: "example",
    }),
  });
  assert.equal(mappingResponse.status, 201);
  const { agent_token: mapping } = await mappingResponse.json();
  const serviceHeaders = assertionHeader(
    await signAccessToken({ sub: "", common_name: "example-service" }),
  );
  for (const [app, headers, statuses] of [
    [fallback.app, {}, [401, 401]],
    [fallback.app, { Cookie: cookie(await fallback.signIn()) }, [200, 200]],
    [access.app, browserHeaders, [200, 200]],
    [access.app, serviceHeaders, [200, 403]],
  ] as const) {
    for (const [index, path] of ["/api/me", "/api/session"].entries())
      assert.equal(
        (await app.request(path, { headers })).status,
        statuses[index],
      );
  }
  await rejection(
    await access.app.request("/api/users", {
      method: "POST",
      headers: { ...serviceHeaders, ...requestedWith },
      body: JSON.stringify({ username: "denied", email: "denied@example.com" }),
    }),
    403,
    "forbidden",
  );
  assert.equal(
    access.database
      .prepare<[], { count: number }>("SELECT count(*) AS count FROM users")
      .get()?.count,
    2,
  );
  await rejection(
    await access.app.request("/api/users", {
      method: "POST",
      headers: { ...browserHeaders, ...requestedWith },
      body: "{",
    }),
    400,
    "invalid_request",
  );
  const otherHeaders = assertionHeader(
    await signAccessToken({ email: "second@example.com" }),
  );
  await rejection(
    await access.app.request(`/api/agent-tokens/${mapping.id}`, {
      method: "DELETE",
      headers: { ...otherHeaders, ...requestedWith },
      body: JSON.stringify({ user_id: access.admin.id }),
    }),
    404,
    "not_found",
  );
  assert.equal(
    (
      await (
        await access.app.request("/api/agent-tokens", {
          headers: browserHeaders,
        })
      ).json()
    ).agent_tokens.length,
    1,
  );
  assert.notEqual(user.id, access.admin.id);
  await rejection(
    await access.app.request("/api/agent-tokens/unmatched/child", {
      headers: serviceHeaders,
    }),
    403,
    "forbidden",
  );
});

test("HTTP output enforcement withholds extra fields and cookie effects and preserves error headers", async (context) => {
  const setup = fixture(context);
  const headers = { ...requestedWith, Cookie: cookie(await setup.signIn()) };
  const original = whoami.handler;
  context.after(() => {
    whoami.handler = original;
  });
  const logged = context.mock.method(console, "error", () => {});
  for (const extra of [{ password_hash: "private-value" }, {}]) {
    whoami.handler = () => ({
      status: 200,
      body: {
        user: {
          ...toPublicUser(setup.admin),
          ...(Object.keys(extra).length === 0
            ? { private_field: "private-value" }
            : {}),
        },
        ...extra,
      },
      effects: { setSessionCookie: "must-not-be-sent" },
    });
    await rejection(
      await setup.app.request("/api/me", { headers }),
      500,
      "internal",
    );
  }
  assert.deepEqual(
    logged.mock.calls.map((call) => call.arguments),
    [
      ["operation_output_rejected", "whoami"],
      ["operation_output_rejected", "whoami"],
    ],
  );
  whoami.handler = () => {
    throw new OperationError(503, "busy", { "Retry-After": "1" });
  };
  const response = await setup.app.request("/api/me", { headers });
  await rejection(response, 503, "busy");
  assert.equal(response.headers.get("Retry-After"), "1");
  whoami.handler = () => ({
    status: 204,
    effects: { clearSessionCookie: true },
  });
  const empty = await setup.app.request("/api/me", { headers });
  assert.equal(empty.status, 204);
  assert.equal(await empty.text(), "");
  assert.match(empty.headers.get("Set-Cookie") ?? "", /Max-Age=0/);
});
