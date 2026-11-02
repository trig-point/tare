import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/auth/password.ts";
import {
  cookie,
  credentials,
  fixture,
  publicUser,
  rejection,
  requestedWith,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";

const newAccount = {
  username: "example-member",
  password: " invented-member-password ",
};

test("administrator adds a non-administrator who signs in with the exact password", async (context) => {
  const setup = fixture(context, { verifyPassword });
  setup.database
    .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .run(await hashPassword(credentials.password), setup.admin.id);
  const sessionCookie = cookie(await setup.signIn());
  const response = await setup.app.request("/api/users", {
    method: "POST",
    headers: { ...requestedWith, Cookie: sessionCookie },
    body: JSON.stringify({
      ...newAccount,
      username: ` ${newAccount.username} `,
      is_admin: true,
    }),
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Set-Cookie"), null);
  const person = await publicUser(response);
  assert.equal(person.username, newAccount.username);
  assert.equal(person.timezone, "Asia/Kolkata");
  assert.equal(person.is_admin, false);
  assert.notEqual(person.id, setup.admin.id);
  const signedIn = await setup.signIn(newAccount);
  assert.equal(signedIn.status, 200);
  assert.deepEqual(await publicUser(signedIn), person);
  await rejection(
    await setup.signIn({ ...newAccount, password: newAccount.password.trim() }),
    401,
    "invalid_credentials",
  );
});

test("add-user denies missing cookies, missing headers and non-administrators without changing users", async (context) => {
  const setup = fixture(context);
  const sessionCookie = cookie(await setup.signIn());
  const headers = { ...requestedWith, Cookie: sessionCookie };
  const before = setup.database.prepare("SELECT * FROM users").all();
  const sessions = setup.rows();
  setup.calls.length = 0;
  for (const Cookie of [undefined, "tare_session=dead"]) {
    await rejection(
      await setup.app.request("/api/users", {
        method: "POST",
        headers: Cookie ? { ...requestedWith, Cookie } : requestedWith,
        body: JSON.stringify(newAccount),
      }),
      401,
      "unauthenticated",
    );
  }
  await rejection(
    await setup.app.request("/api/users", {
      method: "POST",
      headers: { Cookie: sessionCookie },
      body: JSON.stringify(newAccount),
    }),
    403,
    "requested_with_required",
  );
  assert.deepEqual(setup.database.prepare("SELECT * FROM users").all(), before);
  setup.database
    .prepare("UPDATE users SET is_admin = 0 WHERE id = ?")
    .run(setup.admin.id);
  const nonAdminRows = setup.database.prepare("SELECT * FROM users").all();
  await rejection(
    await setup.app.request("/api/users", {
      method: "POST",
      headers,
      body: JSON.stringify(newAccount),
    }),
    403,
    "forbidden",
  );
  assert.deepEqual(
    setup.database.prepare("SELECT * FROM users").all(),
    nonAdminRows,
  );
  assert.deepEqual(setup.rows(), sessions);
  assert.deepEqual(setup.calls, []);
  setup.database
    .prepare("UPDATE users SET is_admin = 1 WHERE id = ?")
    .run(setup.admin.id);
  assert.equal(
    (
      await setup.app.request("/api/users", {
        method: "POST",
        headers,
        body: JSON.stringify(newAccount),
      })
    ).status,
    201,
  );
});

test("add-user preserves case-sensitive uniqueness and accepts explicit timezone and input limits", async (context) => {
  const setup = fixture(context);
  const headers = { ...requestedWith, Cookie: cookie(await setup.signIn()) };
  const addUser = (body: unknown) =>
    setup.app.request("/api/users", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  const before = setup.database.prepare("SELECT * FROM users").all();
  await rejection(await addUser(credentials), 409, "username_taken");
  assert.deepEqual(setup.database.prepare("SELECT * FROM users").all(), before);
  for (const username of [credentials.username.toUpperCase(), "u".repeat(64)]) {
    const response = await addUser({
      username,
      password: "p".repeat(1024),
      timezone: "Europe/Paris",
    });
    assert.equal(response.status, 201);
    const person = await publicUser(response);
    assert.equal(person.username, username);
    assert.equal(person.timezone, "Europe/Paris");
    assert.equal(person.is_admin, false);
  }
  assert.equal(setup.database.prepare("SELECT * FROM users").all().length, 3);
});

test("add-user rejects malformed, missing, empty and oversized fields without changing rows or verifying", async (context) => {
  const setup = fixture(context);
  const headers = { ...requestedWith, Cookie: cookie(await setup.signIn()) };
  const before = setup.database.prepare("SELECT * FROM users").all();
  const sessions = setup.rows();
  setup.calls.length = 0;
  const bodies = [
    "",
    "{",
    ...[null, [], 42, {}, { username: "example" }, { password: "example" }].map(
      (body) => JSON.stringify(body),
    ),
    ...[
      { username: "" },
      { username: "   " },
      { username: "u".repeat(65) },
      { username: 1 },
      { password: "" },
      { password: "p".repeat(1025) },
      { password: false },
      { timezone: "" },
      { timezone: "not-a-timezone" },
      { timezone: "+01:00" },
      { timezone: null },
      { timezone: 1 },
    ].map((fields) => JSON.stringify({ ...newAccount, ...fields })),
  ];
  for (const body of bodies) {
    await rejection(
      await setup.app.request("/api/users", { method: "POST", headers, body }),
      400,
      "invalid_request",
    );
  }
  for (const lengthHeader of [{}, { "Content-Length": "9000" }] as Record<
    string,
    string
  >[]) {
    await rejection(
      await setup.app.request("/api/users", {
        method: "POST",
        headers: { ...headers, ...lengthHeader },
        body: "x".repeat(9000),
      }),
      413,
      "body_too_large",
    );
  }
  for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
    await rejection(
      await setup.app.request("/api/users", { method, headers }),
      404,
      "not_found",
    );
  }
  assert.deepEqual(setup.database.prepare("SELECT * FROM users").all(), before);
  assert.deepEqual(setup.rows(), sessions);
  assert.deepEqual(setup.calls, []);
});

test("add-user returns a private JSON 500 for an unexpected insert failure", async (context) => {
  const setup = fixture(context);
  const headers = { ...requestedWith, Cookie: cookie(await setup.signIn()) };
  const logged = context.mock.method(console, "error", () => {});
  const before = setup.database.prepare("SELECT * FROM users").all();
  const sessions = setup.rows();
  setup.calls.length = 0;
  setup.database.exec(`
    CREATE TRIGGER reject_account BEFORE INSERT ON users
    BEGIN SELECT RAISE(ABORT, 'private-insert-message'); END;
  `);
  await rejection(
    await setup.app.request("/api/users", {
      method: "POST",
      headers,
      body: JSON.stringify(newAccount),
    }),
    500,
    "internal",
  );
  assert.deepEqual(
    logged.mock.calls.map((call) => call.arguments),
    [["request_failed", "SqliteError"]],
  );
  assert.deepEqual(setup.database.prepare("SELECT * FROM users").all(), before);
  assert.deepEqual(setup.rows(), sessions);
  assert.deepEqual(setup.calls, []);
});

test("add-user stays available when all sign-in verification slots are occupied", async (context) => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<boolean>();
  let hold = false;
  let waiting = 0;
  const setup = fixture(context, {
    verifyPassword: async () => {
      if (!hold) return true;
      waiting++;
      if (waiting === 8) entered.resolve();
      return release.promise;
    },
  });
  const headers = { ...requestedWith, Cookie: cookie(await setup.signIn()) };
  hold = true;
  const inflight = Array.from({ length: 8 }, () => setup.signIn());
  context.after(async () => {
    release.resolve(false);
    await Promise.all(inflight);
  });
  await entered.promise;
  await rejection(await setup.signIn(), 503, "busy");
  const response = await setup.app.request("/api/users", {
    method: "POST",
    headers,
    body: JSON.stringify(newAccount),
  });
  assert.equal(response.status, 201);
  assert.equal((await publicUser(response)).username, newAccount.username);
  assert.equal(waiting, 8);
});
