import assert from "node:assert/strict";
import { countUsers } from "../src/queries/count-users.ts";
import { rejection } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

for (const mode of ["access", "fallback"] as const) {
  test(`${mode}: session check reports the identity mode`, async (context) => {
    const setup = await twoUsers(context, mode);
    const response = await setup.admin.request("/api/session");
    assert.equal(response.status, 200);
    const logoutUrl =
      "https://example-team.cloudflareaccess.com/cdn-cgi/access/logout";
    assert.deepEqual(await response.json(), {
      user: setup.admin.user,
      mode,
      ...(mode === "access" ? { logout_url: logoutUrl } : {}),
    });
  });

  test(`${mode}: each user acts as themselves and only the administrator adds users`, async (context) => {
    const setup = await twoUsers(context, mode);
    for (const person of [setup.admin, setup.member]) {
      const { user } = await (await person.request("/api/session")).json();
      assert.equal(user.id, person.user.id);
    }
    const body = JSON.stringify({
      username: "third-example",
      password: "invented-third-password",
      email: "third@example.com",
    });
    await rejection(
      await setup.member.request("/api/users", { method: "POST", body }),
      403,
      "forbidden",
    );
    assert.deepEqual(countUsers(setup.database), { count: 2 });
  });
}
