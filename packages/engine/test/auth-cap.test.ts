import assert from "node:assert/strict";
import { fixture, rejection } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";

test("waiting-work cap refuses overflow and releases success, failure and throw slots", async (context) => {
  const held: ReturnType<typeof Promise.withResolvers<boolean>>[] = [];
  let changed = Promise.withResolvers<void>();
  const setup = fixture(context, {
    verifyPassword: async () => {
      const pending = Promise.withResolvers<boolean>();
      held.push(pending);
      changed.resolve();
      changed = Promise.withResolvers<void>();
      return pending.promise;
    },
  });
  context.after(() => {
    for (const pending of held) pending.resolve(false);
  });
  const waitForCalls = async (count: number) => {
    while (held.length < count) await changed.promise;
  };
  const inflight = Array.from({ length: 8 }, () => setup.signIn());
  const knownOverflow = setup.signIn();
  await waitForCalls(8);
  assert.equal(held.length, 8);
  for (const username of ["example-admin", "unknown"]) {
    const overflow =
      username === "example-admin"
        ? knownOverflow
        : setup.signIn({ username, password: "invented-password" });
    const result = await Promise.race([
      overflow,
      changed.promise.then(() => "overflow verified"),
    ]);
    assert.ok(
      result instanceof Response,
      "overflow must respond before another verification starts",
    );
    assert.equal(result.headers.get("Retry-After"), "1");
    await rejection(result, 503, "busy");
    assert.equal(held.length, 8);
  }
  for (const [index, outcome] of [
    true,
    false,
    new Error("private-verifier-message"),
  ].entries()) {
    const pending = held[index];
    assert.ok(pending);
    if (outcome instanceof Error) pending.reject(outcome);
    else pending.resolve(outcome);
    const response = await inflight[index];
    assert.ok(response);
    if (outcome instanceof Error) await rejection(response, 500, "internal");
    else assert.equal(response.status, outcome ? 200 : 401);
    const admitted = setup.signIn();
    const result = await Promise.race([
      admitted,
      changed.promise.then(() => "verification started"),
    ]);
    assert.equal(
      result,
      "verification started",
      "released slot must admit the next request",
    );
    assert.equal(held.length, 9 + index);
    inflight.push(admitted);
  }
  for (const pending of held) pending.resolve(false);
  await Promise.all(inflight);
});
