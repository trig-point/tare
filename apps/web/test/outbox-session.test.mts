import assert from "node:assert/strict";
import { isCancelledError, QueryClient } from "@tanstack/react-query";
import type { SessionOutcome } from "../src/outbox-http.ts";
import type { QueueSnapshot } from "../src/outbox-replay.ts";
import { OutboxSession, type SessionState } from "../src/outbox-session.ts";
import { outboxView } from "../src/outbox-view.ts";
import {
  deferred,
  fixture,
  json,
  other,
  person,
  session,
} from "./outbox-support.mts";
import { test } from "./support.mts";

const clearedQueue = (version: number): QueueSnapshot => ({
  type: "ready",
  session: { session: null, version },
  records: [],
  pending: 0,
  rejected: 0,
  last_pass: null,
  storage_warning: false,
  channel_error: false,
});

test("new session data cancels a TanStack query before installation; stale person, signed-out and retry results cannot overwrite it", async (context) => {
  for (const populated of [false, true])
    for (const outcome of [
      { type: "person", session: session(other) },
      { type: "signed_out" },
      { type: "retry" },
    ] satisfies SessionOutcome[]) {
      const { store } = await fixture(context);
      const client = new QueryClient();
      const controller = new OutboxSession(store, client);
      context.after(() => client.clear());
      if (populated) await store.cacheSession(0, session());
      const captured = await store.session();
      const result = deferred<SessionState>();
      const entered = deferred<void>();
      const work = client
        .fetchQuery({
          queryKey: controller.query().queryKey,
          retry: false,
          queryFn: () => {
            entered.resolve();
            return result.promise;
          },
        })
        .catch((error: unknown) => error);
      await entered.promise;
      const newer = await store.bumpSession();
      assert.ok(newer);
      const kept: SessionOutcome = populated
        ? { type: "person", session: session() }
        : { type: "signed_out" };
      assert.equal(await controller.accept(kept, newer.version), true);
      result.resolve({ outcome, version: captured.version });
      assert.equal(isCancelledError(await work), true);
      assert.deepEqual(client.getQueryData(controller.query().queryKey), {
        outcome: kept,
        version: newer.version,
      });
      assert.deepEqual(await store.session(), newer);
    }
});

test("the typed session query discards bumped results without updating cache, query or replay", async (context) => {
  for (const populated of [false, true])
    for (const response of [
      json(session(other)),
      new Response('{"error":{"code":"unauthenticated"}}', {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "X-Tare-Auth-Mode": "fallback",
        },
      }),
      new Response(null, { status: 503 }),
    ]) {
      const { store } = await fixture(context);
      if (populated) await store.cacheSession(0, session());
      const client = new QueryClient();
      context.after(() => client.clear());
      const entered = deferred<void>();
      const result = deferred<Response>();
      let wakes = 0;
      const controller = new OutboxSession(store, client, {
        fetch: async () => {
          entered.resolve();
          return result.promise;
        },
      });
      controller.wake = () => {
        wakes++;
      };
      const work = controller.refresh();
      await entered.promise;
      const newer = await store.bumpSession();
      assert.ok(newer);
      result.resolve(response);
      assert.deepEqual(await work, { accepted: false });
      assert.deepEqual(await store.session(), newer);
      assert.equal(client.getQueryData(controller.query().queryKey), undefined);
      if (!populated)
        assert.equal(
          outboxView(undefined, clearedQueue(newer.version), true).screen,
          "sign_in_needed",
        );
      assert.equal(wakes, 0);
    }
});

test("sign-in bumps before its follow-up read, identity rereads wake only for a different person, and Access clears before navigation", async (context) => {
  const { store } = await fixture(context);
  const client = new QueryClient();
  context.after(() => client.clear());
  let current = person;
  let wakes = 0;
  const controller = new OutboxSession(store, client, {
    fetch: async () => {
      assert.ok((await store.session()).version >= 1);
      return json(session(current));
    },
  });
  controller.wake = () => {
    wakes++;
  };
  context.mock.method(globalThis, "fetch", async () => json({}));
  await controller.signIn("example-person", "example-password");
  assert.equal((await store.session()).version, 2);
  assert.equal(wakes, 1);
  await controller.identityRefused();
  assert.equal(wakes, 1);
  current = other;
  await controller.identityRefused();
  assert.equal(wakes, 2);
  let navigated = false;
  await controller.signOut(
    { mode: "access", user: other, logout_url: "https://example.com/logout" },
    (href) => {
      assert.equal(href, "https://example.com/logout");
      const state = client.getQueryData<SessionState>(
        controller.query().queryKey,
      );
      assert.equal(state?.outcome.type, "sign_in_needed");
      navigated = true;
    },
  );
  assert.equal(navigated, true);
  assert.equal((await store.session()).session, null);
});

test("an identity refusal cancels an in-flight same-person shell read without waking replay", async (context) => {
  const { store } = await fixture(context);
  await store.cacheSession(0, session());
  const client = new QueryClient();
  context.after(() => client.clear());
  const entered = deferred<void>(),
    rereading = deferred<void>(),
    result = deferred<Response>();
  let reads = 0,
    wakes = 0;
  const controller = new OutboxSession(store, client, {
    fetch: async () => {
      if (++reads !== 1) return json(session());
      entered.resolve();
      return result.promise;
    },
  });
  controller.wake = () => {
    wakes++;
  };
  const refresh = controller.refresh.bind(controller);
  context.mock.method(controller, "refresh", (wake = true) => {
    const work = refresh(wake);
    if (!wake) rereading.resolve();
    return work;
  });
  const original = controller.refresh();
  await entered.promise;
  const refused = controller.identityRefused();
  await rereading.promise;
  result.resolve(json(session()));
  await Promise.all([original, refused]);
  assert.equal(wakes, 0);
  assert.equal(reads, 2);
});

test("the shell table scopes records and preserves rejected entries and warnings under every connection screen", async (context) => {
  const { store } = await fixture(context);
  const entry = await store.enqueue("weight", { weight_kg: 70 }, person);
  const record = {
    ...entry,
    state: "rejected" as const,
    error_code: "already_saved",
    server_row: { ...entry.body, weight_kg: 60 },
  };
  const base: Extract<QueueSnapshot, { type: "ready" }> = {
    type: "ready",
    session: { session: session(), version: 2 },
    records: [record],
    pending: 0,
    rejected: 1,
    last_pass: null,
    storage_warning: true,
    channel_error: false,
  };
  for (const [outcome, cached, online, screen, status, link] of [
    ["offline", true, false, "app", "Offline", false],
    ["offline", false, false, "offline", "Offline", false],
    ["retry", true, true, "app", "Couldn’t sync", false],
    ["retry", false, true, "outage", "Couldn’t sync", false],
    ["sign_in_needed", true, true, "app", "Sign in needed", true],
    ["sign_in_needed", false, true, "sign_in_needed", "Sign in needed", true],
    ["signed_out", false, true, "signed_out", "Signed out", false],
  ] as const) {
    const snapshot = {
      ...base,
      session: { session: cached ? session() : null, version: 2 },
    };
    const view = outboxView(
      { outcome: { type: outcome }, version: 2 },
      snapshot,
      online,
    );
    assert.deepEqual(
      [view.screen, view.status, view.signIn],
      [screen, status, link],
    );
    assert.equal(view.records.length, cached ? 1 : 0);
  }
  assert.equal(outboxView(undefined, base, true).storageWarning, true);
  assert.equal(
    outboxView(
      undefined,
      { type: "storage_error", error: new Error("Store failed") },
      true,
    ).status,
    "Couldn’t sync",
  );
  assert.equal(
    outboxView(
      { outcome: { type: "person", session: session(other) }, version: 3 },
      base,
      true,
    ).records.length,
    0,
  );
  assert.equal(
    outboxView({ outcome: { type: "retry" }, version: 1 }, base, true).status,
    "1 rejected",
  );
  assert.equal(
    outboxView(undefined, { ...base, records: [], rejected: 0 }, true).status,
    "Synced",
  );
  assert.equal(
    outboxView(
      undefined,
      { ...base, records: [entry], pending: 1, rejected: 0 },
      true,
    ).status,
    "1 pending",
  );
  for (const outcome of [
    { type: "person", session: session() },
    {
      type: "person",
      session: {
        mode: "access",
        user: person,
        logout_url: "https://example.com/logout",
      },
    },
    { type: "signed_out" },
    { type: "retry" },
    { type: "offline" },
    { type: "sign_in_needed" },
    undefined,
  ] satisfies (SessionOutcome | undefined)[]) {
    const view = outboxView(
      outcome ? { outcome, version: 1 } : undefined,
      clearedQueue(2),
      true,
    );
    const signedOut =
      outcome?.type === "signed_out" ||
      (outcome?.type === "person" && outcome.session.mode === "fallback");
    assert.equal(view.screen, signedOut ? "signed_out" : "sign_in_needed");
    assert.equal(view.session, null);
    assert.equal(view.signIn, !signedOut);
  }
});
