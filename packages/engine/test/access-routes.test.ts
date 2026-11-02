import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  type AuthEnv,
  currentPerson,
  requireRequestedWith,
} from "../src/auth/middleware.ts";
import { verifyPassword } from "../src/auth/password.ts";
import { createSession } from "../src/auth/sessions.ts";
import { countUsers } from "../src/queries/count-users.ts";
import {
  accessFixture,
  assertionHeader,
  fixture,
  issuedAt,
  rejection,
  requestedWith,
  signAccessToken,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";

test("Access authenticates unknown paths, accepts only the header, and disables password routes", async (context) => {
  const setup = accessFixture(context);
  const token = await signAccessToken();
  const session = createSession(
    setup.database,
    setup.admin.id,
    undefined,
    issuedAt,
    30,
  );
  const cookieCases: Record<string, string>[] = [
    {},
    { Cookie: `CF_Authorization=${token}` },
    { Cookie: `tare_session=${session}` },
    assertionHeader("malformed"),
  ];
  for (const headers of cookieCases)
    await rejection(
      await setup.app.request("/api/session", { headers }),
      401,
      "unauthenticated",
    );
  for (const path of ["/missing", "/inbound-email", "/health/child"])
    await rejection(
      await setup.app.request(path),
      401,
      "unauthenticated",
      false,
    );
  assert.equal((await setup.app.request("/health")).status, 200);
  for (const [path, method] of [
    ["/api/session", "POST"],
    ["/api/session", "DELETE"],
    ["/api/users", "POST"],
  ] as const)
    await rejection(
      await setup.app.request(path, {
        method,
        headers: { ...assertionHeader(token), ...requestedWith },
        body: JSON.stringify({
          username: "another-example",
          password: "invented-password",
        }),
      }),
      404,
      "not_found",
    );
  assert.deepEqual(countUsers(setup.database), { count: 1 });
  const fallback = fixture(context);
  await rejection(
    await fallback.app.request("/api/session", {
      headers: assertionHeader(token),
    }),
    401,
    "unauthenticated",
  );
});

test("Access browser writes need Requested-With and currentPerson fails when absent", async () => {
  const app = new Hono<AuthEnv>();
  let effects = 0;
  app.use("*", async (context, next) => {
    context.set("credential", "access");
    await next();
  });
  app.post("/write", requireRequestedWith, (context) => {
    effects++;
    return context.body(null, 204);
  });
  app.get("/missing-person", (context) => {
    assert.throws(() => currentPerson(context), /Authenticated person missing/);
    return context.body(null, 204);
  });
  await rejection(
    await app.request("/write", { method: "POST" }),
    403,
    "requested_with_required",
    false,
  );
  assert.equal(effects, 0);
  assert.equal(
    (await app.request("/write", { method: "POST", headers: requestedWith }))
      .status,
    204,
  );
  assert.equal(effects, 1);
  assert.equal((await app.request("/missing-person")).status, 204);
});

test("null-hash fallback user rejects even the dummy password like any wrong password", async (context) => {
  const setup = fixture(context, { verifyPassword });
  setup.database
    .prepare("UPDATE users SET password_hash = NULL WHERE id = ?")
    .run(setup.admin.id);
  const response = await setup.signIn({
    username: setup.admin.username,
    password: "invented-dummy-password",
  });
  await rejection(response, 401, "invalid_credentials");
  await rejection(
    await setup.signIn({
      username: "unknown-example",
      password: "invented-dummy-password",
    }),
    401,
    "invalid_credentials",
  );
  assert.deepEqual(setup.rows(), []);
});
