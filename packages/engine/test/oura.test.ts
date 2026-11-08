import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { TestContext } from "node:test";
import { Hono } from "hono";
import { createApp } from "../src/app.ts";
import type { AuthEnv } from "../src/auth/middleware.ts";
import { loadConfig } from "../src/config.ts";
import { agentOperations, operations } from "../src/operations/index.ts";
import { mountOuraCallback } from "../src/oura/callback.ts";
import type { TokenTransport } from "../src/oura/provider.ts";
import { createOura } from "../src/oura/service.ts";
import { selectConnection } from "../src/queries/oura/select-connection.ts";
import {
  assertionHeader,
  cookie,
  dummyHash,
  issuedAt,
  keySet,
  rejection,
  signAccessToken,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const appEnv = {
  TARE_OURA_CLIENT_ID: "invented-client",
  TARE_OURA_CLIENT_SECRET: "invented-secret",
  TARE_OURA_REDIRECT_URL: "https://tare.example.test/api/oura/callback",
};
const key = Buffer.alloc(32, 7);
const tokens = {
  access_token: "invented-access",
  refresh_token: "invented-refresh",
  token_type: "bEaReR",
  expires_in: 3600,
};
const pair = {
  access_token: tokens.access_token,
  refresh_token: tokens.refresh_token,
};
const callbackPath = (state: string) =>
  `/api/oura/callback?code=invented-code&state=${state}`;
function redirect(response: Response, success = false) {
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("Location"),
    success ? "/?oura=connected" : "/?oura=failed",
  );
  assert.equal(response.headers.get("Cache-Control"), "no-store");
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setupOura(
  context: TestContext,
  mode: "access" | "fallback" = "fallback",
) {
  const setup = await twoUsers(context, mode);
  const config = loadConfig({
    DATABASE_URL: ":memory:",
    ...appEnv,
    TARE_OURA_TOKEN_KEY: key.toString("base64"),
    ...(mode === "access"
      ? {
          TARE_ACCESS_TEAM_DOMAIN: "https://example-team.cloudflareaccess.com",
          TARE_ACCESS_AUD: "example-audience",
        }
      : {}),
  });
  let now = issuedAt;
  const clock = { now: () => now };
  let respond: TokenTransport = async () => Response.json(tokens);
  let exchanges = 0;
  let dataReply = () => Response.json({ data: [] });
  const oura = createOura({
    database: setup.database,
    config,
    clock,
    fetch: (async () => dataReply()) as typeof fetch,
    transport: async (url, options) => {
      exchanges++;
      assert.equal(setup.database.inTransaction, false);
      assert.equal(url, "https://api.ouraring.com/oauth/token");
      assert.equal(options.method, "POST");
      const fields = new URLSearchParams(options.body);
      assert.equal(fields.get("redirect_uri"), appEnv.TARE_OURA_REDIRECT_URL);
      assert.equal(fields.get("client_secret"), appEnv.TARE_OURA_CLIENT_SECRET);
      assert.equal(fields.get("client_id"), appEnv.TARE_OURA_CLIENT_ID);
      assert.equal(fields.get("grant_type"), "authorization_code");
      assert.equal(fields.get("code"), "invented-code");
      assert.match(fields.get("code_verifier") ?? "", /^[A-Za-z0-9_-]{43}$/);
      return respond(url, options);
    },
  });
  context.after(() => oura.stop());
  const app = createApp({
    database: setup.database,
    config,
    clock,
    oura,
    dummyHash,
    accessKeySet: keySet,
    verifyPassword: async () => false,
  });
  const person = async (who: typeof setup.admin) => {
    const headers =
      mode === "access"
        ? assertionHeader(
            await signAccessToken({
              email: who.credentials.email,
              exp: 9_999_999_999,
            }),
          )
        : { Cookie: cookie(await setup.signIn(who.credentials)) };
    const request = (path: string, init: RequestInit = {}) =>
      app.request(path, {
        ...init,
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          ...headers,
          ...init.headers,
        },
      });
    const connect = async () => {
      const response = await request("/api/oura/connect", {
        method: "POST",
        body: "{}",
      });
      assert.equal(response.status, 200);
      return new URL((await response.json()).authorization_url);
    };
    const state = async () =>
      (await connect()).searchParams.get("state") as string;
    const finish = async () => request(callbackPath(await state()));
    return { id: who.user.id as number, request, connect, state, finish };
  };
  return {
    ...setup,
    app,
    oura,
    config,
    clock,
    admin: await person(setup.admin),
    member: await person(setup.member),
    connection: (owner = setup.admin.user.id as number) =>
      selectConnection(setup.database, { user_id: owner }),
    exchanges: () => exchanges,
    respond: (value: TokenTransport) => {
      respond = value;
    },
    dataReply: (value: () => Response) => {
      dataReply = value;
    },
    setTime: (value: Date) => {
      now = value;
    },
  };
}

test("a scopeless token that gets 401 on the daily check stores reconnect, not connected", async (context) => {
  const setup = await setupOura(context);
  setup.respond(async () => Response.json({ ...tokens, scope: null }));
  setup.dataReply(() => new Response(null, { status: 401 }));
  const response = await setup.admin.finish();
  assert.equal(response.headers.get("Location"), "/?oura=no_data");
  const body = await (await setup.admin.request("/api/oura")).json();
  assert.partialDeepStrictEqual(body, {
    status: "reconnect_required",
    reconnect_required: true,
  });
});

for (const mode of ["access", "fallback"] as const)
  test(`Oura state belongs to its browser owner, expires strictly and exchanges once (${mode})`, async (context) => {
    const setup = await setupOura(context, mode);
    const url = await setup.admin.connect();
    assert.equal(
      url.origin + url.pathname,
      "https://cloud.ouraring.com/oauth/authorize",
    );
    assert.equal(
      url.searchParams.get("redirect_uri"),
      appEnv.TARE_OURA_REDIRECT_URL,
    );
    assert.equal(url.searchParams.get("scope"), "daily workout");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const stored = setup.database
      .prepare("SELECT * FROM oura_states")
      .get() as { verifier: string; state_hash: string };
    assert.equal(
      url.searchParams.get("code_challenge"),
      createHash("sha256").update(stored.verifier).digest("base64url"),
    );
    const state = url.searchParams.get("state") as string;
    assert.notEqual(stored.state_hash, state);
    redirect(await setup.member.request(callbackPath(state)));
    assert.equal(setup.exchanges(), 0);
    assert.deepEqual(
      setup.database.prepare("SELECT * FROM oura_states").get(),
      stored,
    );
    assert.equal(setup.connection(setup.member.id), null);
    const replies = await Promise.all([
      setup.admin.request(callbackPath(state), {
        headers: { "X-Requested-With": "" },
      }),
      setup.admin.request(callbackPath(state)),
    ]);
    assert.deepEqual(
      replies.map((reply) => reply.headers.get("Location")).sort(),
      ["/?oura=connected", "/?oura=failed"],
    );
    for (const reply of replies) assert.equal(reply.status, 303);
    assert.equal(setup.exchanges(), 1);
    const before = setup.connection();
    for (const path of [
      callbackPath(state),
      "/api/oura/callback",
      callbackPath("bad"),
      `${callbackPath(await setup.admin.state())}&state=duplicate`,
    ])
      redirect(await setup.admin.request(path));
    const expiring = await setup.admin.state();
    setup.setTime(new Date(issuedAt.getTime() + 600_000));
    redirect(await setup.admin.request(callbackPath(expiring)));
    assert.equal(setup.exchanges(), 1);
    assert.deepEqual(setup.connection(), before);
    setup.oura.job.run();
    assert.deepEqual(
      setup.database.prepare("SELECT count(*) AS count FROM oura_states").get(),
      { count: 0 },
    );
  });

test("Oura scopes, encrypted pair, reconnect generation and safe metadata", async (context) => {
  const setup = await setupOura(context);
  for (const [index, scope] of [
    " daily workout daily ",
    "daily",
    ["daily", "workout"],
    undefined,
  ].entries()) {
    setup.respond(async () =>
      Response.json({ ...tokens, ...(scope === undefined ? {} : { scope }) }),
    );
    const first = await setup.admin.state();
    const state = await setup.admin.state();
    redirect(await setup.admin.request(callbackPath(first)));
    redirect(await setup.admin.request(callbackPath(state)), true);
    const row = setup.connection();
    assert.ok(row);
    assert.equal(row.generation, index + 1);
    const body = await (await setup.admin.request("/api/oura")).json();
    assert.partialDeepStrictEqual(body, {
      status: "connected",
      scopes: scope === "daily" ? ["daily"] : ["daily", "workout"],
      scope_source: scope === undefined ? "requested" : "response",
      access_expires_at: "2026-01-01T01:00:00.000Z",
      last_synced_at: index === 0 ? null : "2025-12-31T00:00:00.000Z",
    });
    for (const secret of [
      ...Object.values(pair),
      state,
      appEnv.TARE_OURA_CLIENT_SECRET,
    ])
      assert.ok(!JSON.stringify(body).includes(secret));
    setup.database
      .prepare(
        "UPDATE oura_connections SET last_synced_at = ? WHERE user_id = ?",
      )
      .run("2025-12-31T00:00:00.000Z", setup.admin.id);
  }
});

test("Oura refuses malformed pairs and provider failures without exposing causes", async (context) => {
  const setup = await setupOura(context);
  redirect(await setup.admin.finish(), true);
  const before = setup.connection();
  const captured: unknown[] = [];
  for (const method of ["error", "warn", "info", "log"] as const)
    context.mock.method(console, method, (...args: unknown[]) => {
      captured.push(args);
    });
  const invalid = [
    { ...tokens, access_token: "" },
    { ...tokens, refresh_token: undefined },
    { ...tokens, token_type: "mac" },
    { ...tokens, expires_in: 0 },
    { ...tokens, expires_in: 1.5 },
    { ...tokens, expires_in: undefined },
    { ...tokens, expires_in: "3600" },
    { ...tokens, expires_in: "3600garbage" },
    { ...tokens, expires_in: [3600] },
    { ...tokens, scope: 1 },
  ];
  for (const body of invalid) {
    setup.respond(async () => Response.json(body));
    redirect(await setup.admin.finish());
  }
  const failed = await setup.admin.state();
  setup.respond(async () => {
    throw new Error("invented-provider-error", {
      cause: {
        ...tokens,
        state: failed,
        code: "invented-code",
        secret: appEnv.TARE_OURA_CLIENT_SECRET,
      },
    });
  });
  redirect(await setup.admin.request(callbackPath(failed)));
  redirect(await setup.admin.request(callbackPath(failed)));
  const calls = setup.exchanges();
  const denied = await setup.admin.state();
  redirect(
    await setup.admin.request(
      `/api/oura/callback?state=${denied}&error=access_denied&error_description=invented-provider-error`,
    ),
  );
  assert.equal(setup.exchanges(), calls);
  assert.deepEqual(setup.connection(), before);
  assert.ok(captured.length > 0);
  const logged = JSON.stringify(captured);
  for (const secret of [
    ...Object.values(pair),
    failed,
    denied,
    "invented-code",
    appEnv.TARE_OURA_CLIENT_SECRET,
  ])
    assert.ok(!logged.includes(secret));
});

test("Oura callback accepts Oura's issuer and logs a rejected one", async (context) => {
  const setup = await setupOura(context);
  const captured: unknown[][] = [];
  context.mock.method(console, "error", (...args: unknown[]) => {
    captured.push(args);
  });
  const withIssuer = async (issuer: string) =>
    setup.admin.request(
      `${callbackPath(await setup.admin.state())}&iss=${encodeURIComponent(issuer)}`,
    );
  redirect(await withIssuer("https://cloud.ouraring.com"));
  assert.equal(setup.exchanges(), 0);
  assert.equal(setup.connection(), null);
  assert.deepEqual(captured, [
    [
      "oura_callback_failed",
      "OperationProcessingError",
      'unexpected "iss" (issuer) response parameter value',
    ],
  ]);
  redirect(
    await withIssuer("https://moi.ouraring.com/oauth/v2/ext/oauth-anonymous"),
    true,
  );
  assert.equal(setup.exchanges(), 1);
  assert.ok(setup.connection());
  assert.equal(captured.length, 1);
});

for (const mode of ["access", "fallback"] as const)
  test(`Oura entry points require browser identity and strict input (${mode})`, async (context) => {
    const setup = await setupOura(context, mode);
    const connect = operations.find(
      (operation) => operation.name === "connect_oura",
    );
    assert.ok(connect);
    assert.equal(connect.callerClass, "browser");
    assert.equal(
      connect.input.safeParse({ owner: setup.member.id }).success,
      false,
    );
    assert.ok(!agentOperations.includes(connect));
    const post = { method: "POST", body: "{}" };
    const denied = async (
      response: Response | Promise<Response>,
      status: number,
      code: string,
    ) => rejection(await response, status, code, false);
    await denied(
      setup.admin.request("/api/oura/connect", {
        ...post,
        headers: { "X-Requested-With": "" },
      }),
      403,
      "requested_with_required",
    );
    await denied(
      setup.admin.request("/api/oura/connect", {
        ...post,
        body: '{"owner":2}',
      }),
      400,
      "invalid_request",
    );
    const serviceIdentity = { sub: "", common_name: "invented-service" };
    const serviceHeaders = assertionHeader(
      await signAccessToken(serviceIdentity),
    );
    for (const path of ["/api/oura/callback", "/api/oura/connect"]) {
      const init = {
        ...(path.endsWith("connect") ? post : {}),
        headers: { "X-Requested-With": "XMLHttpRequest" },
      };
      await denied(setup.app.request(path, init), 401, "unauthenticated");
      if (mode !== "access") continue;
      for (const [payload, code] of [
        [{ email: "outsider@example.com" }, "not_a_member"],
        [serviceIdentity, "unknown_agent"],
      ] as const) {
        const headers = {
          ...init.headers,
          ...assertionHeader(await signAccessToken(payload)),
        };
        await denied(setup.app.request(path, { ...init, headers }), 403, code);
      }
    }
    if (mode === "access") {
      setup.database
        .prepare(
          "INSERT INTO agent_tokens (user_id, client_id, name, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(
          setup.admin.id,
          "invented-service",
          "Invented service",
          issuedAt.toISOString(),
        );
      await denied(
        setup.app.request("/api/oura/callback", { headers: serviceHeaders }),
        403,
        "forbidden",
      );
      await denied(
        setup.app.request("/api/oura/connect", {
          ...post,
          headers: serviceHeaders,
        }),
        403,
        "forbidden",
      );
      const app = new Hono<AuthEnv>();
      app.use("*", async (request, next) => {
        request.set("person", {
          id: setup.admin.id,
        } as AuthEnv["Variables"]["person"]);
        request.set("credential", "service");
        await next();
      });
      mountOuraCallback(app, setup);
      await denied(app.request("/api/oura/callback"), 403, "forbidden");
    }
    assert.equal(setup.exchanges(), 0);
  });

test("Oura cleanup preserves live state and shutdown aborts an outstanding exchange", async (context) => {
  const setup = await setupOura(context);
  await setup.admin.state();
  setup.setTime(new Date(issuedAt.getTime() + 600_000));
  const state = await setup.member.state();
  setup.oura.cleanup();
  assert.deepEqual(
    setup.database.prepare("SELECT user_id FROM oura_states").all(),
    [{ user_id: setup.member.id }],
  );
  const entered = deferred();
  let signal: AbortSignal | undefined;
  setup.respond(async (_url, options) => {
    signal = options.signal as AbortSignal;
    entered.resolve();
    return new Promise<Response>((_resolve, reject) =>
      signal?.addEventListener(
        "abort",
        () => reject(new Error("invented-abort-cause")),
        { once: true },
      ),
    );
  });
  const callback = setup.member.request(callbackPath(state));
  await entered.promise;
  await setup.oura.stop();
  assert.equal(signal?.aborted, true);
  redirect(await callback);
  assert.equal(setup.connection(setup.member.id), null);
  await rejection(
    await setup.member.request("/api/oura/connect", {
      method: "POST",
      body: "{}",
    }),
    503,
    "oura_unavailable",
  );
});

test("Oura connect reports missing settings and key without creating state", async (context) => {
  const setup = await setupOura(context);
  for (const [env, code] of [
    [{}, "oura_not_configured"],
    [appEnv, "oura_key_unavailable"],
  ] as const) {
    const service = createOura({
      database: setup.database,
      clock: setup.clock,
      config: loadConfig({ DATABASE_URL: ":memory:", ...env }),
    });
    await assert.rejects(service.connect(setup.admin.id), { code });
    await service.stop();
  }
  assert.deepEqual(
    setup.database.prepare("SELECT count(*) AS count FROM oura_states").get(),
    { count: 0 },
  );
});

test("Oura stale grants cannot replace a newer pair and save failures stay fixed", async (context) => {
  const setup = await setupOura(context);
  for (const existing of [false, true]) {
    if (existing) redirect(await setup.admin.finish(), true);
    const entered = deferred();
    const release = deferred();
    setup.respond(async () => {
      entered.resolve();
      await release.promise;
      return Response.json(tokens);
    });
    const late = setup.admin.finish();
    await entered.promise;
    setup.respond(async () =>
      Response.json({ ...tokens, access_token: "invented-new-access" }),
    );
    redirect(await setup.admin.finish(), true);
    const before = setup.connection();
    release.resolve();
    redirect(await late);
    assert.deepEqual(setup.connection(), before);
  }
  setup.respond(async () => {
    setup.database.exec(
      "CREATE TRIGGER fail_oura BEFORE UPDATE ON oura_connections BEGIN SELECT RAISE(ABORT, 'invented-db-error'); END",
    );
    return Response.json(tokens);
  });
  const before = setup.connection();
  redirect(await setup.admin.finish());
  assert.deepEqual(setup.connection(), before);
  assert.deepEqual(
    setup.database.prepare("SELECT count(*) AS count FROM oura_states").get(),
    { count: 0 },
  );
});

test("Oura exchange ignores id_token, null or string", async (context) => {
  const setup = await setupOura(context);
  for (const idToken of [null, "invented-id-token"]) {
    setup.respond(async () => Response.json({ ...tokens, id_token: idToken }));
    redirect(await setup.admin.finish(), true);
    const body = await (await setup.admin.request("/api/oura")).json();
    assert.partialDeepStrictEqual(body, {
      status: "connected",
      credentials: "readable",
    });
  }
});

test("Oura logs a rejected token body as field names and types only", async (context) => {
  const setup = await setupOura(context);
  const captured: unknown[][] = [];
  context.mock.method(console, "error", (...args: unknown[]) => {
    captured.push(args);
  });
  setup.respond(async () =>
    Response.json({ ...tokens, expires_in: null, id_token: "invented-id" }),
  );
  redirect(await setup.admin.finish());
  assert.deepEqual(captured[0], [
    "oura_token_body_rejected",
    "access_token:string refresh_token:string token_type:string expires_in:null id_token:string",
  ]);
  const logged = JSON.stringify(captured);
  for (const secret of [...Object.values(pair), "invented-id"])
    assert.ok(!logged.includes(secret));
});
