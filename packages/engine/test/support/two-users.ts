import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { hashPassword, verifyPassword } from "../../src/auth/password.ts";
import type { AppOptions } from "../../src/auth/routes.ts";
import { countUsers } from "../../src/queries/count-users.ts";
import {
  accessFixture,
  assertionHeader,
  cookie,
  credentials,
  fixture,
  publicUser,
  signAccessToken,
} from "../auth-support.ts";

export async function twoUsers(
  context: TestContext,
  mode: "access" | "fallback",
  overrides: Partial<AppOptions> = {},
) {
  const setup =
    mode === "access"
      ? accessFixture(context, undefined, overrides)
      : fixture(context, { verifyPassword, ...overrides });
  setup.database
    .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .run(
      mode === "access" ? null : await hashPassword(credentials.password),
      setup.admin.id,
    );
  const memberCredentials = {
    username: "example-member",
    password: "invented-member-password",
    email: "member@example.com",
  };
  const personRequest = async (person: typeof memberCredentials) => {
    const credentialHeaders =
      mode === "access"
        ? assertionHeader(await signAccessToken({ email: person.email }))
        : { Cookie: cookie(await setup.signIn(person)) };
    return async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      for (const [name, value] of Object.entries(credentialHeaders))
        headers.set(name, value);
      if (!["GET", "HEAD", "OPTIONS"].includes(init.method ?? "GET"))
        headers.set("X-Requested-With", "XMLHttpRequest");
      return setup.app.request(path, { ...init, headers });
    };
  };
  const adminCredentials = { ...credentials, email: "admin@example.com" };
  const adminRequest = await personRequest(adminCredentials);
  const response = await adminRequest("/api/users", {
    method: "POST",
    body: JSON.stringify(memberCredentials),
  });
  assert.equal(response.status, 201);
  const member = await publicUser(response);
  const admin = await publicUser(await adminRequest("/api/session"));
  assert.notEqual(admin.id, member.id);
  assert.deepEqual(countUsers(setup.database), { count: 2 });
  return {
    ...setup,
    admin: {
      user: admin,
      credentials: adminCredentials,
      request: adminRequest,
    },
    member: {
      user: member,
      credentials: memberCredentials,
      request: await personRequest(memberCredentials),
    },
  };
}
