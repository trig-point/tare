import assert from "node:assert/strict";
import { storeOuraConnection } from "../src/oura/connections.ts";
import {
  canary,
  code,
  deferred,
  key,
  origin,
  setup,
} from "./oura-refresh-support.ts";
import { test } from "./support/hang-ceiling.ts";

for (const outcome of ["success", "failure", "short"])
  test(`same-turn callers share one ${outcome} grant, then idle removal permits a fresh batch`, async (context) => {
    const fixture = setup(context);
    fixture.seed();
    fixture.respond(async (body) =>
      outcome === "failure"
        ? Response.json({ error: "invalid_grant" }, { status: 503 })
        : Response.json({
            ...body,
            expires_in: outcome === "short" ? 1 : 3600,
          }),
    );
    const first = fixture.service();
    const second = fixture.service();
    const calls = [
      first.refreshAccess(1),
      second.refreshAccess(1),
      first.refreshAccess(1),
    ] as const;
    const expected = outcome === "success" ? "success" : "503:oura_unavailable";
    const results = await Promise.all(calls.map(code));
    assert.equal(fixture.grants(), 1);
    assert.deepEqual(results, [expected, expected, expected]);
    assert.equal(fixture.row()?.generation, outcome === "failure" ? 1 : 2);
    if (outcome === "success")
      assert.equal(fixture.pair()?.access_token, (await calls[0]).accessToken);
    fixture.setTime(origin + 3_600_000);
    const later = await Promise.all([
      code(first.refreshAccess(1)),
      code(second.refreshAccess(1)),
    ]);
    assert.equal(fixture.grants(), 2);
    assert.equal(later[0], later[1]);
  });

for (const [status, error, expected] of [
  [400, "invalid_grant", "409:oura_reconnect_required"],
  ...[
    "invalid_client",
    "unauthorized_client",
    "unsupported_grant_type",
    "invalid_request",
    "invalid_scope",
  ].map((error) => [400, error, "503:oura_client_rejected"] as const),
  [401, "invalid_grant", "503:oura_client_rejected"],
  [401, "invalid_client", "503:oura_client_rejected"],
  [429, "invalid_grant", "503:oura_rate_limited"],
  [503, "invalid_grant", "503:oura_unavailable"],
  [500, "invalid_client", "503:oura_unavailable"],
  [403, "invalid_grant", "503:oura_unavailable"],
  [400, "unknown", "503:oura_unavailable"],
  [418, "invalid_client", "503:oura_unavailable"],
] as const)
  test(`refresh classification ${status}/${error} preserves HTTP precedence`, async (context) => {
    const fixture = setup(context);
    fixture.seed();
    const before = fixture.row();
    fixture.respond(async () =>
      Response.json(
        { error, error_description: canary, access_token: canary },
        { status },
      ),
    );
    assert.equal(await code(fixture.service().refreshAccess(1)), expected);
    assert.equal(fixture.row()?.generation, 1);
    if (expected === "409:oura_reconnect_required") {
      assert.equal(fixture.row()?.status, "reconnect_required");
      assert.ok(
        storeOuraConnection(
          fixture.database,
          1,
          1,
          {
            pair: {
              access_token: "callback-access",
              refresh_token: "callback-refresh",
            },
            expiresAt: "2026-01-01T01:00:00.000Z",
          },
          key,
          fixture.clock.now(),
        ),
      );
    } else assert.deepEqual(fixture.row(), before);
  });

test("malformed responses, challenges, network and timeout failures discard token canaries", async (context) => {
  const captured: unknown[] = [];
  for (const method of ["log", "error", "warn", "info"] as const)
    context.mock.method(console, method, (...args: unknown[]) =>
      captured.push(args),
    );
  for (const change of [
    { access_token: "" },
    { refresh_token: undefined },
    { token_type: "mac" },
    { expires_in: "30junk" },
    { expires_in: 1.5 },
    { expires_in: 1e300 },
    { scope: 1 },
    null,
    "network",
    "timeout",
    "challenge",
    "html",
    "rate-html",
  ]) {
    const fixture = setup(context);
    fixture.seed();
    const before = fixture.row();
    fixture.respond(async (body) => {
      if (change === "network") throw new Error(canary, { cause: canary });
      if (change === "timeout") throw new DOMException(canary, "TimeoutError");
      if (change === "challenge")
        return new Response(canary, {
          status: 401,
          headers: { "WWW-Authenticate": `Bearer error="${canary}"` },
        });
      if (typeof change === "string")
        return new Response(canary, {
          status: change === "rate-html" ? 429 : 200,
        });
      return Response.json(
        change === null
          ? null
          : {
              ...body,
              ...change,
              access_token:
                "access_token" in change ? change.access_token : canary,
            },
      );
    });
    assert.equal(
      await code(fixture.service().refreshAccess(1)),
      change === "challenge"
        ? "503:oura_client_rejected"
        : change === "rate-html"
          ? "503:oura_rate_limited"
          : "503:oura_unavailable",
    );
    assert.deepEqual(fixture.row(), before);
  }
  assert.deepEqual(captured, []);
});

test("key, missing row, unreadable, reconnect and app checks follow flow order", async (context) => {
  const fixture = setup(context);
  const service = fixture.service();
  assert.equal(await code(service.refreshAccess(1)), "404:oura_not_connected");
  fixture.seed();
  assert.equal(
    await code(
      fixture
        .service({ config: { ...fixture.config, ouraTokenKey: undefined } })
        .refreshAccess(1),
    ),
    "503:oura_key_unavailable",
  );
  assert.equal(
    await code(
      fixture
        .service({
          config: { ...fixture.config, ouraTokenKey: Buffer.alloc(32) },
        })
        .refreshAccess(1),
    ),
    "409:oura_reconnect_required",
  );
  assert.equal(
    await code(
      fixture
        .service({ config: { ...fixture.config, oura: null } })
        .refreshAccess(1),
    ),
    "503:oura_not_configured",
  );
  fixture.database.exec(
    "UPDATE oura_connections SET status = 'reconnect_required'",
  );
  assert.equal(
    await code(service.refreshAccess(1)),
    "409:oura_reconnect_required",
  );
  assert.equal(fixture.grants(), 0);
  await service.stop();
  fixture.database.close();
  assert.equal(await code(service.refreshAccess(1)), "503:oura_unavailable");
});

test("scope omission and empty scope, membership status, reuse without app settings", async (context) => {
  const fixture = setup(context);
  fixture.seed();
  fixture.database.exec(
    "UPDATE oura_connections SET status = 'membership_required', scope_source = 'requested'",
  );
  const service = fixture.service();
  await service.refreshAccess(1);
  assert.equal(fixture.row()?.scopes, '["daily"]');
  assert.equal(fixture.row()?.scope_source, "requested");
  assert.equal(fixture.row()?.status, "membership_required");
  assert.equal(
    await code(
      fixture
        .service({ config: { ...fixture.config, oura: null } })
        .refreshAccess(1),
    ),
    "success",
  );
  assert.equal(fixture.grants(), 1);
  fixture.setTime(origin + 3_600_000);
  fixture.respond(async (body) => Response.json({ ...body, scope: null }));
  assert.equal(await code(service.refreshAccess(1)), "success");
  assert.equal(fixture.row()?.scopes, '["daily"]');
  assert.equal(fixture.row()?.scope_source, "requested");
  fixture.setTime(origin + 7_200_000);
  fixture.respond(async (body) => Response.json({ ...body, scope: "" }));
  await service.refreshAccess(1);
  assert.equal(fixture.row()?.scopes, "[]");
  assert.equal(fixture.row()?.scope_source, "response");
});

test("held person A never blocks or changes B, and separate databases never contend", async (context) => {
  const fixture = setup(context);
  fixture.seed();
  fixture.seed(2);
  const other = setup(context);
  other.seed();
  const entered = deferred();
  const release = deferred();
  fixture.respond(async (body) => {
    entered.resolve();
    await release.promise;
    return Response.json(body, { status: 503 });
  });
  const service = fixture.service();
  const pending = code(service.refreshAccess(1));
  await entered.promise;
  fixture.respond(async (body) => Response.json(body));
  await service.refreshAccess(2);
  const before = fixture.row(2);
  await other.service().refreshAccess(1);
  release.resolve();
  assert.equal(await pending, "503:oura_unavailable");
  assert.deepEqual(fixture.row(2), before);
});

for (const replacement of [
  "fresh",
  "expired",
  "gone",
  "reconnect",
  "unreadable",
])
  test(`compare-and-swap loss to ${replacement} never re-grants or changes the winner`, async (context) => {
    const fixture = setup(context);
    fixture.seed();
    fixture.respond(async (body) => {
      if (replacement === "gone")
        fixture.database.exec("DELETE FROM oura_connections");
      else {
        fixture.seed(
          1,
          1,
          replacement === "expired"
            ? new Date(origin).toISOString()
            : "2026-01-01T02:00:00.000Z",
        );
        if (replacement === "reconnect")
          fixture.database.exec(
            "UPDATE oura_connections SET status = 'reconnect_required'",
          );
        if (replacement === "unreadable")
          fixture.database.exec(
            "UPDATE oura_connections SET ciphertext = 'invalid'",
          );
      }
      return Response.json(body);
    });
    const result = await code(fixture.service().refreshAccess(1));
    assert.equal(
      result,
      replacement === "fresh"
        ? "success"
        : replacement === "gone"
          ? "404:oura_not_connected"
          : replacement === "expired"
            ? "503:oura_unavailable"
            : "409:oura_reconnect_required",
    );
    assert.equal(fixture.grants(), 1);
    assert.equal(
      fixture.pair()?.access_token ?? null,
      ["gone", "unreadable"].includes(replacement) ? null : "old-access-1",
    );
  });

test("reconnect mark losing a generation race preserves the winning connection", async (context) => {
  const fixture = setup(context);
  fixture.seed();
  fixture.respond(async () => {
    fixture.seed(1, 1, "2026-01-01T02:00:00.000Z");
    return Response.json({ error: "invalid_grant" }, { status: 400 });
  });
  assert.equal(await code(fixture.service().refreshAccess(1)), "success");
  assert.equal(fixture.row()?.status, "connected");
  assert.equal(fixture.row()?.generation, 2);
});

for (const stopping of ["starter", "joiner", "both", "single"])
  test(`shutdown ${stopping} detaches callers and preserves only running ownership`, async (context) => {
    const fixture = setup(context);
    fixture.seed();
    const entered = deferred();
    const release = deferred();
    let signal!: AbortSignal;
    fixture.respond(async (body, requestSignal) => {
      signal = requestSignal;
      entered.resolve();
      await Promise.race([
        release.promise,
        new Promise<void>((resolve) =>
          requestSignal.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        ),
      ]);
      if (signal.aborted) throw new Error(canary);
      return Response.json(body);
    });
    const starter = fixture.service();
    const joiner = fixture.service();
    const initial = code(starter.refreshAccess(1));
    const joined = stopping === "single" ? null : code(joiner.refreshAccess(1));
    await entered.promise;
    if (stopping !== "joiner") await starter.stop();
    if (stopping === "both" || stopping === "joiner") await joiner.stop();
    assert.equal(signal.aborted, stopping === "both" || stopping === "single");
    release.resolve();
    assert.equal(
      await initial,
      stopping === "joiner" ? "success" : "503:oura_unavailable",
    );
    if (joined)
      assert.equal(
        await joined,
        stopping === "starter" ? "success" : "503:oura_unavailable",
      );
    assert.equal(
      fixture.row()?.generation,
      stopping === "both" || stopping === "single" ? 1 : 2,
    );
    assert.equal(fixture.grants(), 1);
  });

test("aborted predecessor pins the entry, queued stopped attempt and successor retain one mutex", async (context) => {
  const fixture = setup(context);
  fixture.seed();
  const entered = deferred();
  const release = deferred();
  const successorEntered = deferred();
  const successorRelease = deferred();
  const first = fixture.service({
    transport: async (_url, options) => {
      entered.resolve();
      await release.promise;
      assert.equal(options.signal?.aborted, true);
      throw new Error(canary);
    },
  });
  fixture.respond(async () => {
    successorEntered.resolve();
    await successorRelease.promise;
    return Response.json({ error: "invalid_grant" }, { status: 503 });
  });
  const stopped = fixture.service();
  const live = fixture.service();
  const initial = code(first.refreshAccess(1));
  await entered.promise;
  const firstStop = first.stop();
  const queued = code(stopped.refreshAccess(1));
  const queuedStop = stopped.stop();
  const later = code(live.refreshAccess(1));
  assert.equal(fixture.grants(), 0);
  release.resolve();
  await Promise.all([firstStop, queuedStop]);
  await successorEntered.promise;
  const sameTurn = code(live.refreshAccess(1));
  successorRelease.resolve();
  assert.deepEqual(await Promise.all([initial, queued, later, sameTurn]), [
    "503:oura_unavailable",
    "503:oura_unavailable",
    "503:oura_unavailable",
    "503:oura_unavailable",
  ]);
  assert.equal(fixture.grants(), 1);
  assert.equal(fixture.row()?.status, "connected");
});

for (const boundary of ["before-validation", "after-validation"])
  test(`last owner stops ${boundary}; late validated pair still gets its first save`, async (context) => {
    const fixture = setup(context);
    fixture.seed();
    const service = fixture.service();
    let stopping: Promise<void> | undefined;
    if (boundary === "before-validation") {
      fixture.respond(async (body, signal) => {
        stopping = service.stop();
        assert.equal(signal.aborted, true);
        return Response.json(body);
      });
    } else {
      const now = fixture.clock.now;
      let readings = 0;
      context.mock.method(fixture.clock, "now", () => {
        readings++;
        if (readings === 3) stopping = service.stop();
        return now();
      });
    }
    assert.equal(await code(service.refreshAccess(1)), "503:oura_unavailable");
    assert.ok(stopping);
    await stopping;
    assert.equal(fixture.row()?.generation, 2);
    assert.equal(fixture.pair()?.access_token, "access-1");
  });

for (const failure of ["permanent", "busy", "deadline", "stop"])
  test(`save ${failure}: bounded retries, restored busy timeout, no repeated grant`, async (context) => {
    const fixture = setup(context);
    fixture.seed();
    const service = fixture.service();
    const before = fixture.row();
    const prepare = fixture.database.prepare.bind(fixture.database);
    let writes = 0;
    const budgets: unknown[] = [];
    let stopping: Promise<void> | undefined;
    context.mock.method(fixture.database, "prepare", (sql: string) => {
      if (sql.includes("status = CASE")) {
        writes++;
        budgets.push(fixture.database.pragma("busy_timeout", { simple: true }));
        if (failure === "stop") stopping = service.stop();
        if (failure === "deadline") fixture.setTime(origin + 15_000);
        if (failure !== "busy" || writes === 1)
          throw new Error(canary, { cause: "SQLITE_BUSY" });
      }
      return prepare(sql);
    });
    if (failure === "deadline") {
      const now = fixture.clock.now;
      let readings = 0;
      context.mock.method(fixture.clock, "now", () => {
        readings++;
        if (readings === 4) fixture.setTime(origin + 14_900);
        return now();
      });
    }
    assert.equal(
      await code(service.refreshAccess(1)),
      failure === "busy"
        ? "success"
        : failure === "stop"
          ? "503:oura_unavailable"
          : "500:oura_save_failed",
    );
    await stopping;
    assert.equal(
      writes,
      failure === "permanent" ? 4 : failure === "busy" ? 2 : 1,
    );
    assert.deepEqual(
      budgets,
      Array.from({ length: writes }, () =>
        failure === "deadline" ? 100 : 5000,
      ),
    );
    assert.equal(
      fixture.database.pragma("busy_timeout", { simple: true }),
      5000,
    );
    assert.equal(fixture.grants(), 1);
    if (failure !== "busy") assert.deepEqual(fixture.row(), before);
    if (failure === "permanent") {
      assert.equal(
        await code(service.refreshAccess(1)),
        "409:oura_reconnect_required",
      );
      assert.equal(fixture.row()?.status, "reconnect_required");
    }
  });

for (const operation of ["read", "mark"])
  test(`SQLite ${operation} failure returns a fixed code without retries`, async (context) => {
    const fixture = setup(context);
    fixture.seed();
    const before = fixture.row();
    fixture.respond(async () =>
      Response.json({ error: "invalid_grant" }, { status: 400 }),
    );
    const prepare = fixture.database.prepare.bind(fixture.database);
    let failures = 0;
    context.mock.method(fixture.database, "prepare", (sql: string) => {
      if (
        operation === "read"
          ? sql.includes("SELECT * FROM oura_connections")
          : sql.includes("SET status = 'reconnect_required'")
      ) {
        failures++;
        throw new Error(canary);
      }
      return prepare(sql);
    });
    assert.equal(
      await code(fixture.service().refreshAccess(1)),
      operation === "read"
        ? "503:oura_unavailable"
        : "409:oura_reconnect_required",
    );
    context.mock.restoreAll();
    assert.equal(failures, 1);
    assert.deepEqual(fixture.row(), before);
  });

test("generated interleavings agree with consumed, unseen and stored generation model", async (context) => {
  for (let schedule = 0; schedule < 32; schedule++) {
    const fixture = setup(context);
    fixture.seed();
    const services = [fixture.service(), fixture.service()] as const;
    const entered = deferred();
    const release = deferred();
    const model = { stored: 1, consumed: 0, unseen: false, discarded: false };
    fixture.respond(async (body) => {
      model.consumed++;
      entered.resolve();
      await release.promise;
      if (schedule & 4) {
        model.unseen = true;
        throw new Error(canary);
      }
      return Response.json(body);
    });
    const first = code(services[0].refreshAccess(1));
    const second = code(services[1].refreshAccess(1));
    await entered.promise;
    assert.equal(fixture.row()?.generation, model.stored);
    const stops: Promise<void>[] = [];
    if (schedule & 1) stops.push(services[0].stop());
    if (schedule & 2) stops.push(services[1].stop());
    if (schedule & 8) {
      fixture.seed(1, 1, "2026-01-01T02:00:00.000Z");
      model.stored++;
      model.discarded = true;
    }
    assert.equal(fixture.row()?.generation, model.stored);
    if (schedule & 16)
      fixture.database.exec(
        "CREATE TRIGGER fail_refresh BEFORE UPDATE ON oura_connections BEGIN SELECT RAISE(ABORT, 'invented-save-error'); END",
      );
    const prepare = fixture.database.prepare.bind(fixture.database);
    let saves = 0;
    context.mock.method(fixture.database, "prepare", (sql: string) => {
      if (sql.includes("status = CASE")) saves++;
      return prepare(sql);
    });
    release.resolve();
    await Promise.all([first, second, ...stops]);
    if (!model.unseen && !(schedule & 16) && !model.discarded) model.stored++;
    assert.equal(fixture.row()?.generation, model.stored);
    assert.equal(fixture.grants(), model.consumed);
    assert.equal(
      saves,
      model.unseen
        ? 0
        : model.discarded
          ? 1
          : schedule & 16
            ? (schedule & 3) === 3
              ? 1
              : 4
            : 1,
    );
    if (schedule & 16) fixture.database.exec("DROP TRIGGER fail_refresh");
    const result = await code(fixture.service().refreshAccess(1));
    assert.equal(
      result,
      model.stored === 1 ? "409:oura_reconnect_required" : "success",
    );
    assert.equal(
      fixture.row()?.status,
      model.stored === 1 ? "reconnect_required" : "connected",
    );
    assert.equal(fixture.grants(), model.stored === 1 ? 2 : 1);
  }
});

test("request timeout uses the attempt signal and leaves the row unchanged", async (context) => {
  const fixture = setup(context);
  fixture.seed();
  const before = fixture.row();
  const timeout = new AbortController();
  const entered = deferred();
  context.mock.method(AbortSignal, "timeout", (duration: number) => {
    assert.equal(duration, 15_000);
    return timeout.signal;
  });
  fixture.respond(async (_body, signal) => {
    entered.resolve();
    return new Promise<Response>((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(new Error(canary)), {
        once: true,
      }),
    );
  });
  const result = code(fixture.service().refreshAccess(1));
  await entered.promise;
  timeout.abort();
  assert.equal(await result, "503:oura_unavailable");
  assert.deepEqual(fixture.row(), before);
});
