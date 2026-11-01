import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  type AuthEnv,
  requireRequestedWith,
  sessionAuth,
} from "../src/auth/middleware.ts";
import { cookie, fixture, rejection, requestedWith } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";

test("guard fails closed with unset credentials and uses the credential actually selected", async (context) => {
  const setup = fixture(context);
  const sessionCookie = cookie(await setup.signIn());
  const app = new Hono<AuthEnv>();
  let effects = 0;
  app.use("/mixed", async (context, next) => {
    if (context.req.header("Authorization") === "Bearer example-test-token") {
      context.set("credential", "token");
      await next();
    } else
      return sessionAuth(setup.database, {
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      })(context, next);
  });
  app.use("*", requireRequestedWith);
  app.all("*", (context) => {
    effects++;
    return context.json({ ok: true });
  });
  await rejection(
    await app.request("/unset", { method: "POST" }),
    403,
    "requested_with_required",
    false,
  );
  assert.equal(effects, 0);
  assert.equal(
    (await app.request("/unset", { method: "POST", headers: requestedWith }))
      .status,
    200,
  );
  await rejection(
    await app.request("/mixed", {
      method: "POST",
      headers: { Cookie: sessionCookie },
    }),
    403,
    "requested_with_required",
    false,
  );
  assert.equal(effects, 1);
  assert.equal(
    (
      await app.request("/mixed", {
        method: "POST",
        headers: {
          Cookie: sessionCookie,
          Authorization: "Bearer example-test-token",
        },
      })
    ).status,
    200,
  );
  for (const method of ["GET", "HEAD", "OPTIONS"])
    assert.equal(
      (
        await app.request("/mixed", {
          method,
          headers: { Cookie: sessionCookie },
        })
      ).status,
      200,
    );
  assert.equal(effects, 5);
});
