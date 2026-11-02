import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ensureFirstUser } from "../src/auth/bootstrap.ts";
import { hashPassword, verifyPassword } from "../src/auth/password.ts";
import { loadConfig } from "../src/config.ts";
import {
  cookie,
  credentials,
  dummyHash,
  fixture,
  publicUser,
  rejection,
  requestedWith,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";

test("bootstrap administrator signs in with the real verifier and exact password", async (context) => {
  const settings = {
    username: "bootstrap-example",
    password: " invented-password ",
  };
  const setup = fixture(context, { verifyPassword });
  setup.database.prepare("DELETE FROM users").run();
  await ensureFirstUser(
    setup.database,
    settings,
    "UTC",
    { now: () => new Date("2026-01-01T00:00:00.000Z") },
    hashPassword,
  );
  const response = await setup.signIn(settings);
  assert.equal(response.status, 200);
  assert.equal((await publicUser(response)).is_admin, true);
  await rejection(
    await setup.signIn({ ...settings, password: settings.password.trim() }),
    401,
    "invalid_credentials",
  );
});

for (const publicUrl of [
  undefined,
  "http://tare.example.test",
  "https://tare.example.test",
]) {
  test(`cookie attributes, stored digest and sign-out for ${publicUrl ?? "unset URL"}`, async (context) => {
    const setup = fixture(context, {
      config: loadConfig({
        DATABASE_URL: ":memory:",
        TARE_PUBLIC_URL: publicUrl,
        TARE_SESSION_DAYS: "2",
      }),
    });
    const response = await setup.signIn({
      ...credentials,
      username: ` ${credentials.username} `,
    });
    assert.equal(response.status, 200);
    assert.equal((await publicUser(response)).username, credentials.username);
    const sessionCookie = cookie(response);
    const attributes = [
      "Max-Age=172800",
      "Path=/",
      "HttpOnly",
      ...(publicUrl?.startsWith("https:") ? ["Secure"] : []),
      "SameSite=Lax",
    ];
    assert.deepEqual(
      response.headers.get("Set-Cookie")?.split("; ").slice(1),
      attributes,
    );
    const token = sessionCookie.slice("tare_session=".length);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(setup.rows(), [
      {
        token_hash: createHash("sha256").update(token).digest("hex"),
        user_id: setup.admin.id,
        created_at: "2026-01-01T00:00:00.000Z",
        expires_at: "2026-01-03T00:00:00.000Z",
      },
    ]);
    assert.ok(!Object.values(setup.rows()[0] as object).includes(token));
    const check = await setup.app.request("/api/session", {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(check.status, 200);
    assert.equal((await publicUser(check)).id, setup.admin.id);
    const liveRows = setup.rows();
    await rejection(
      await setup.app.request("/api/session", {
        method: "DELETE",
        headers: { Cookie: sessionCookie },
      }),
      403,
      "requested_with_required",
    );
    assert.deepEqual(setup.rows(), liveRows);
    const signedOut = await setup.app.request("/api/session", {
      method: "DELETE",
      headers: { ...requestedWith, Cookie: sessionCookie },
    });
    assert.equal(signedOut.status, 204);
    assert.equal(signedOut.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(signedOut.headers.get("Set-Cookie")?.split("; "), [
      "tare_session=",
      ...attributes.map((attribute) =>
        attribute.startsWith("Max-Age=") ? "Max-Age=0" : attribute,
      ),
    ]);
    assert.deepEqual(setup.rows(), []);
    await rejection(
      await setup.app.request("/api/session", {
        headers: { Cookie: sessionCookie },
      }),
      401,
      "unauthenticated",
    );
  });
}

test("wrong password and unknown user verify once and preserve a live cookie", async (context) => {
  const setup = fixture(context);
  const liveCookie = cookie(await setup.signIn());
  setup.calls.length = 0;
  const before = setup.rows();
  for (const body of [
    { ...credentials, password: "wrong" },
    { ...credentials, username: "unknown" },
  ]) {
    await rejection(
      await setup.signIn(body, { ...requestedWith, Cookie: liveCookie }),
      401,
      "invalid_credentials",
    );
    assert.deepEqual(setup.rows(), before);
  }
  assert.deepEqual(setup.calls, ["example-hash", dummyHash]);
  await rejection(
    await setup.signIn(credentials, { Cookie: liveCookie }),
    403,
    "requested_with_required",
  );
  assert.deepEqual(setup.rows(), before);
  assert.equal(
    (
      await setup.app.request("/api/session", {
        headers: { Cookie: liveCookie },
      })
    ).status,
    200,
  );
  const replacement = cookie(
    await setup.signIn(credentials, { ...requestedWith, Cookie: liveCookie }),
  );
  assert.notEqual(replacement, liveCookie);
  assert.equal(setup.rows().length, 1);
  await rejection(
    await setup.app.request("/api/session", {
      headers: { Cookie: liveCookie },
    }),
    401,
    "unauthenticated",
  );
  setup.setNow("2026-01-31T00:00:00.000Z");
  await rejection(
    await setup.app.request("/api/session", {
      headers: { Cookie: replacement },
    }),
    401,
    "unauthenticated",
  );
  await setup.signIn();
  assert.equal(setup.rows().length, 1);
});

test("header check precedes parsing and verification; missing and dead cookies give 401", async (context) => {
  const setup = fixture(context);
  for (const header of [undefined, "xmlhttprequest", "XMLHttpRequestx"]) {
    const headers: Record<string, string> =
      header === undefined ? {} : { "X-Requested-With": header };
    await rejection(
      await setup.app.request("/api/session", {
        method: "POST",
        headers,
        body: "{".repeat(9000),
      }),
      403,
      "requested_with_required",
    );
  }
  assert.deepEqual(setup.rows(), []);
  assert.deepEqual(setup.calls, []);
  for (const method of ["GET", "DELETE"])
    for (const headers of [{}, { Cookie: "tare_session=dead" }] as Record<
      string,
      string
    >[])
      await rejection(
        await setup.app.request("/api/session", { method, headers }),
        401,
        "unauthenticated",
      );
});

test("JSON rejection paths preserve rows and skip verification", async (context) => {
  const setup = fixture(context);
  const sessionCookie = cookie(await setup.signIn());
  const before = setup.rows();
  setup.calls.length = 0;
  {
    const route = "/api/session";
    const headers = { ...requestedWith, Cookie: sessionCookie };
    for (const body of [
      "",
      "{",
      "null",
      "[]",
      "42",
      "{}",
      '{"username":1,"password":"x"}',
      '{"username":"x","password":false}',
    ])
      await rejection(
        await setup.app.request(route, { method: "POST", headers, body }),
        400,
        "invalid_request",
      );
    for (const lengthHeader of [{}, { "Content-Length": "9000" }] as Record<
      string,
      string
    >[])
      await rejection(
        await setup.app.request(route, {
          method: "POST",
          headers: { ...headers, ...lengthHeader },
          body: "x".repeat(9000),
        }),
        413,
        "body_too_large",
      );
    await rejection(
      await setup.app.request(route, { method: "PATCH" }),
      404,
      "not_found",
    );
  }
  await rejection(await setup.app.request("/unknown"), 404, "not_found", false);
  assert.deepEqual(setup.rows(), before);
  assert.deepEqual(setup.calls, []);
});

test("unexpected handler errors return JSON without exposing details or changing state", async (context) => {
  const setup = fixture(context);
  setup.app.put("/api/session", () => {
    throw new Error("private-handler-message");
  });
  await rejection(
    await setup.app.request("/api/session", { method: "PUT" }),
    500,
    "internal",
  );
  assert.deepEqual(setup.rows(), []);
  assert.deepEqual(setup.calls, []);
});
