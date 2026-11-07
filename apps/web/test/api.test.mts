import assert from "node:assert/strict";
import {
  ApiError,
  api,
  endSession,
  readSession,
  signOutTarget,
} from "../src/api.ts";
import { test } from "./support.mts";

test("API sends the browser header and credentials; sign-out accepts empty 204", async (context) => {
  const request: typeof fetch = async (path, options) => {
    assert.equal(path, "/api/session");
    assert.equal(
      new Headers(options?.headers).get("X-Requested-With"),
      "XMLHttpRequest",
    );
    assert.equal(options?.credentials, "same-origin");
    assert.equal(options?.redirect, "manual");
    assert.equal(options?.method, "DELETE");
    return new Response(null, { status: 204 });
  };
  context.mock.method(globalThis, "fetch", request);
  assert.equal(await api("/api/session", { method: "DELETE" }), undefined);
});

test("session read selects the password form only for Tare's fallback JSON 401", async (context) => {
  const response = context.mock.method(globalThis, "fetch");
  response.mock.mockImplementation(async () =>
    Response.json(
      { error: { code: "unauthenticated" } },
      {
        status: 401,
        headers: { "X-Tare-Auth-Mode": "fallback" },
      },
    ),
  );
  assert.equal(await readSession(), null);
  const redirect = Response.error();
  Object.defineProperty(redirect, "type", { value: "opaqueredirect" });
  for (const refused of [
    new Response(null, { status: 401 }),
    Response.json({ error: { code: "unauthenticated" } }, { status: 401 }),
    Response.json(
      {},
      { status: 401, headers: { "X-Tare-Auth-Mode": "fallback" } },
    ),
    redirect,
  ]) {
    response.mock.mockImplementation(async () => refused);
    await assert.rejects(readSession());
  }
  response.mock.mockImplementation(async () => Response.json({}));
  await assert.rejects(readSession());
  response.mock.mockImplementation(
    async () =>
      new Response("<html>Sign in</html>", {
        headers: { "Content-Type": "text/html" },
      }),
  );
  await assert.rejects(readSession(), /Invalid response/);
  response.mock.mockImplementation(async () =>
    Response.json({
      user: { id: 1, username: "example-person" },
      mode: "fallback",
    }),
  );
  assert.equal((await readSession())?.user.username, "example-person");
  response.mock.mockImplementation(
    async () => new Response(null, { status: 503 }),
  );
  await assert.rejects(readSession(), ApiError);
});

test("sign-out selects Access navigation or fallback session deletion", () => {
  const user = { id: 1, username: "example-person" };
  assert.deepEqual(signOutTarget({ user, mode: "fallback" }), {
    method: "DELETE",
    path: "/api/session",
  });
  assert.deepEqual(
    signOutTarget({
      user,
      mode: "access",
      logout_url: "https://example.com/cdn-cgi/access/logout",
    }),
    { href: "https://example.com/cdn-cgi/access/logout" },
  );
});

test("fallback sign-out treats an already ended session as signed out", async (context) => {
  const target = { method: "DELETE" as const, path: "/api/session" };
  const response = context.mock.method(globalThis, "fetch");
  response.mock.mockImplementation(
    async () => new Response(null, { status: 401 }),
  );
  await endSession(target);
  response.mock.mockImplementation(
    async () => new Response(null, { status: 503 }),
  );
  await assert.rejects(endSession(target), ApiError);
});
