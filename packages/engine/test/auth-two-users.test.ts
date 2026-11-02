import assert from "node:assert/strict";
import {
  assertionHeader,
  cookie,
  publicUser,
  rejection,
  signAccessToken,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

for (const mode of ["access", "fallback"] as const) {
  test(`${mode}: session checks keep both identities separate and report exact mode fields`, async (context) => {
    const setup = await twoUsers(context, mode);
    for (const person of [setup.admin, setup.member]) {
      const response = await person.request("/api/session");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Set-Cookie"), null);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.deepEqual(await response.json(), {
        user: person.user,
        mode,
        ...(mode === "access"
          ? {
              logout_url:
                "https://example-team.cloudflareaccess.com/cdn-cgi/access/logout",
            }
          : {}),
      });
    }
    if (mode === "access") {
      const response = await setup.app.request("/api/session", {
        headers: assertionHeader(
          await signAccessToken({ email: "  MEMBER@EXAMPLE.COM  " }),
        ),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await publicUser(response), setup.member.user);
      await rejection(
        await setup.app.request("/api/session", {
          headers: assertionHeader(
            await signAccessToken({ email: "unknown@example.com" }),
          ),
        }),
        403,
        "not_a_member",
      );
    }
  });

  test(`${mode}: only the administrator adds users and body fields cannot choose the actor or role`, async (context) => {
    const setup = await twoUsers(context, mode);
    const account = {
      username: "third-example",
      password: "invented-third-password",
      email: "third@example.com",
      id: setup.member.user.id,
      user_id: setup.member.user.id,
      is_admin: true,
    };
    const before = setup.database.prepare("SELECT * FROM users").all();
    const add = (person: typeof setup.admin, body: unknown) =>
      person.request("/api/users", {
        method: "POST",
        body: JSON.stringify(body),
      });
    await rejection(await add(setup.member, account), 403, "forbidden");
    await rejection(
      await add(setup.admin, {
        ...account,
        username: setup.member.user.username,
      }),
      409,
      "username_taken",
    );
    if (mode === "access")
      await rejection(
        await add(setup.admin, { ...account, email: "  MEMBER@EXAMPLE.COM  " }),
        409,
        "email_taken",
      );
    assert.deepEqual(
      setup.database.prepare("SELECT * FROM users").all(),
      before,
    );
    const response = await add(setup.admin, account);
    assert.equal(response.status, 201);
    const created = await publicUser(response);
    assert.notEqual(created.id, setup.member.user.id);
    assert.notEqual(created.id, setup.admin.user.id);
    assert.equal(created.is_admin, false);
    if (mode === "fallback")
      assert.deepEqual(
        setup.database
          .prepare("SELECT access_email FROM users WHERE id = ?")
          .get(created.id),
        { access_email: null },
      );
    assert.deepEqual(
      await publicUser(await setup.admin.request("/api/session")),
      setup.admin.user,
    );
    assert.deepEqual(
      await publicUser(await setup.member.request("/api/session")),
      setup.member.user,
    );
  });
}

test("fallback: signing out and signing in one user preserves the other user's session", async (context) => {
  const setup = await twoUsers(context, "fallback");
  assert.equal(
    (await setup.member.request("/api/session", { method: "DELETE" })).status,
    204,
  );
  await rejection(
    await setup.member.request("/api/session"),
    401,
    "unauthenticated",
  );
  assert.deepEqual(
    await publicUser(await setup.admin.request("/api/session")),
    setup.admin.user,
  );
  const signedIn = await setup.signIn(setup.member.credentials);
  assert.equal(signedIn.status, 200);
  const response = await setup.app.request("/api/session", {
    headers: { Cookie: cookie(signedIn) },
  });
  assert.deepEqual(await publicUser(response), setup.member.user);
  assert.deepEqual(
    await publicUser(await setup.admin.request("/api/session")),
    setup.admin.user,
  );
});
