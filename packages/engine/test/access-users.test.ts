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

test("Access add-user stores a normalized email and rejects it again in another case", async (context) => {
  const setup = accessFixture(context);
  const add = async (username: string, email: string) =>
    setup.app.request("/api/users", {
      method: "POST",
      headers: {
        ...requestedWith,
        ...assertionHeader(await signAccessToken()),
      },
      body: JSON.stringify({ username, email, password: "ignored-password" }),
    });
  const response = await add("example-member", "  Member@EXAMPLE.com ");
  assert.equal(response.status, 201);
  const person = await publicUser(response);
  assert.equal(person.is_admin, false);
  const stored = "SELECT access_email, password_hash FROM users WHERE id = ?";
  assert.deepEqual(setup.database.prepare(stored).get(person.id), {
    access_email: "member@example.com",
    password_hash: null,
  });
  const session = await setup.session({ email: "member@example.com" });
  assert.deepEqual(await publicUser(session), person);
  await rejection(
    await add("another-member", "MEMBER@example.com"),
    409,
    "email_taken",
  );
});
