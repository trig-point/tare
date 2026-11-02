import assert from "node:assert/strict";
import { Hono } from "hono";
import { type AuthEnv, requireAdmin } from "../src/auth/middleware.ts";
import { selectUser } from "../src/queries/select-user.ts";
import { fixture, rejection } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";

test("administrator guard rejects service and unset credentials but accepts browser administrators", async (context) => {
  const setup = fixture(context);
  const person = selectUser(setup.database, { id: setup.admin.id });
  assert.ok(person);
  let credential: AuthEnv["Variables"]["credential"];
  let effects = 0;
  const app = new Hono<AuthEnv>();
  app.use("*", async (context, next) => {
    context.set("person", person);
    context.set("credential", credential);
    await next();
  });
  app.post("/admin", requireAdmin(setup.database), (context) => {
    effects++;
    return context.body(null, 204);
  });
  for (const denied of ["service", undefined] as const) {
    credential = denied;
    await rejection(
      await app.request("/admin", { method: "POST" }),
      403,
      "forbidden",
      false,
    );
  }
  assert.equal(effects, 0);
  for (const allowed of ["access", "session"] as const) {
    credential = allowed;
    assert.equal((await app.request("/admin", { method: "POST" })).status, 204);
  }
  assert.equal(effects, 2);
  setup.database
    .prepare("UPDATE users SET is_admin = 0 WHERE id = ?")
    .run(person.id);
  await rejection(
    await app.request("/admin", { method: "POST" }),
    403,
    "forbidden",
    false,
  );
  assert.equal(effects, 2);
  setup.database.close();
  for (const denied of ["service", undefined] as const) {
    credential = denied;
    await rejection(
      await app.request("/admin", { method: "POST" }),
      403,
      "forbidden",
      false,
    );
  }
  assert.equal(effects, 2);
});
