import assert from "node:assert/strict";
import {
  accessFixture,
  assertionHeader,
  publicUser,
  rejection,
  requestedWith,
  signAccessToken,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";

const account = { username: "example-member", email: "member@example.com" };

test("Access add-user stores a normalized email without a password and the user can authenticate", async (context) => {
  const setup = accessFixture(context);
  const headers = {
    ...requestedWith,
    ...assertionHeader(await signAccessToken()),
  };
  const response = await setup.app.request("/api/users", {
    method: "POST",
    headers,
    body: JSON.stringify({
      username: ` ${account.username} `,
      email: "  Member@EXAMPLE.com  ",
      password: { ignored: true },
    }),
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Set-Cookie"), null);
  const person = await publicUser(response);
  assert.equal(person.username, account.username);
  assert.equal(person.is_admin, false);
  assert.equal(person.timezone, setup.admin.timezone);
  assert.deepEqual(
    setup.database
      .prepare(
        "SELECT access_email, password_hash, created_at FROM users WHERE id = ?",
      )
      .get(person.id),
    {
      access_email: account.email,
      password_hash: null,
      created_at: "2026-01-01T00:00:00.000Z",
    },
  );
  assert.deepEqual(
    await publicUser(await setup.session({ email: account.email })),
    person,
  );
  const limitResponse = await setup.app.request("/api/users", {
    method: "POST",
    headers,
    body: JSON.stringify({
      username: "u".repeat(64),
      email: ` ${"e".repeat(308)}@example.com `,
      timezone: "Europe/Paris",
    }),
  });
  assert.equal(limitResponse.status, 201);
  assert.equal((await publicUser(limitResponse)).timezone, "Europe/Paris");
  assert.deepEqual(setup.rows(), []);
});

test("Access add-user rejects invalid bodies and oversized requests without changing users", async (context) => {
  const setup = accessFixture(context);
  const headers = {
    ...requestedWith,
    ...assertionHeader(await signAccessToken()),
  };
  const before = setup.database.prepare("SELECT * FROM users").all();
  const bodies = [
    "",
    "{",
    "null",
    "[]",
    "42",
    "{}",
    ...[
      { username: account.username },
      { email: account.email },
      ...[
        { username: "" },
        { username: "   " },
        { username: 42 },
        { username: "u".repeat(65) },
        { email: "" },
        { email: "   " },
        { email: null },
        { email: 42 },
        { email: "e".repeat(321) },
        { timezone: null },
        { timezone: 42 },
        { timezone: "" },
        { timezone: "not-a-timezone" },
      ].map((fields) => ({ ...account, ...fields })),
    ].map((body) => JSON.stringify(body)),
  ];
  for (const body of bodies)
    await rejection(
      await setup.app.request("/api/users", { method: "POST", headers, body }),
      400,
      "invalid_request",
    );
  await rejection(
    await setup.app.request("/api/users", {
      method: "POST",
      headers,
      body: "x".repeat(9000),
    }),
    413,
    "body_too_large",
  );
  await rejection(
    await setup.app.request("/api/users", {
      method: "POST",
      headers: assertionHeader(await signAccessToken()),
      body: JSON.stringify(account),
    }),
    403,
    "requested_with_required",
  );
  await rejection(
    await setup.app.request("/api/users", {
      method: "POST",
      headers: requestedWith,
      body: JSON.stringify(account),
    }),
    401,
    "unauthenticated",
  );
  assert.deepEqual(setup.database.prepare("SELECT * FROM users").all(), before);
});

test("add-user does not disguise an unknown unique constraint as a username conflict", async (context) => {
  const setup = accessFixture(context);
  setup.database.exec("CREATE UNIQUE INDEX one_timezone ON users(timezone)");
  const before = setup.database.prepare("SELECT * FROM users").all();
  const logged = context.mock.method(console, "error", () => {});
  await rejection(
    await setup.app.request("/api/users", {
      method: "POST",
      headers: {
        ...requestedWith,
        ...assertionHeader(await signAccessToken()),
      },
      body: JSON.stringify(account),
    }),
    500,
    "internal",
  );
  assert.deepEqual(
    logged.mock.calls.map((call) => call.arguments),
    [["request_failed", "SqliteError"]],
  );
  assert.deepEqual(setup.database.prepare("SELECT * FROM users").all(), before);
});
