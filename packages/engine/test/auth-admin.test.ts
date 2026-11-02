import assert from "node:assert/strict";
import { Hono } from "hono";
import { type AuthEnv, requireAdmin } from "../src/auth/middleware.ts";
import { selectUser } from "../src/queries/select-user.ts";
import { fixture, rejection } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";

test("administrator guard rejects a service credential but accepts a browser administrator", async (context) => {
  const setup = fixture(context);
  const person = selectUser(setup.database, { id: setup.admin.id });
  assert.ok(person);
  let credential: AuthEnv["Variables"]["credential"] = "service";
  const app = new Hono<AuthEnv>();
  app.use("*", async (context, next) => {
    context.set("person", person);
    context.set("credential", credential);
    await next();
  });
  app.post("/admin", requireAdmin(setup.database), (context) =>
    context.body(null, 204),
  );
  const request = () => app.request("/admin", { method: "POST" });
  await rejection(await request(), 403, "forbidden", false);
  credential = "access";
  assert.equal((await request()).status, 204);
});
