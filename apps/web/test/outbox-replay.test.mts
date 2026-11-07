import assert from "node:assert/strict";
import { readSessionOutcome, type SessionOutcome } from "../src/outbox-http.ts";
import type { QueueSnapshot } from "../src/outbox-replay.ts";
import {
  deferred,
  fixture,
  json,
  ManualScheduler,
  other,
  person,
  server,
  session,
} from "./outbox-support.mts";
import { test } from "./support.mts";

test("deadline bookkeeping against a fake fetch covers hung session, write headers and body, and external abort reaches fetch", async (context) => {
  const { store } = await fixture(context);
  const entry = await store.enqueue("intake", {}, person);
  const { writeEntry } = await import("../src/outbox-http.ts");
  for (const sessionRead of [false, true])
    for (const stage of ["fetch", "body", "abort", "network"]) {
      const scheduler = new ManualScheduler();
      const entered = deferred<AbortSignal>();
      const controller = new AbortController();
      const options = {
        scheduler,
        fetch: (async (_path, init) => {
          const signal = init?.signal as AbortSignal;
          if (stage !== "body") entered.resolve(signal);
          if (stage === "network") throw new Error("Network down");
          const response = json({});
          response.text = () => {
            entered.resolve(signal);
            return new Promise<string>(() => {});
          };
          return stage === "body" ? response : new Promise<Response>(() => {});
        }) satisfies typeof fetch,
      };
      const work = sessionRead
        ? readSessionOutcome(options, controller.signal)
        : writeEntry(entry, options, controller.signal);
      const signal = await entered.promise;
      if (stage === "abort") controller.abort();
      else if (stage !== "network") scheduler.fire();
      assert.equal((await work).type, stage === "abort" ? "aborted" : "retry");
      assert.equal(signal.aborted, stage !== "network");
      assert.deepEqual(scheduler.delays(), []);
    }
});

test("the timer retries after partial progress, caps backoff, and a rejection lets later writes continue", async (context) => {
  const { store, replay, scheduler } = await fixture(context);
  for (const kcal of [100, 200, 300])
    await store.enqueue("intake", { kcal }, person);
  let statuses = [201, 503];
  const endpoint = server();
  const instance = replay({
    fetch: async (_path, options) => {
      const status = statuses.shift() ?? 503;
      const body = JSON.parse(String(options?.body));
      return status === 201
        ? endpoint.reply(body)
        : json({ error: { code: "invalid_entry" } }, status);
    },
  });
  await instance.wake();
  assert.deepEqual(scheduler.delays(), [30_000]);
  const retried = deferred<void>();
  const unsubscribe = instance.subscribe(() => {
    if (scheduler.delays()[0] === 60_000) retried.resolve();
  });
  scheduler.fire();
  await retried.promise;
  unsubscribe();
  for (const delay of [120_000, 240_000, 480_000, 900_000, 900_000]) {
    await instance.wake();
    assert.deepEqual(scheduler.delays(), [delay]);
  }
  statuses = [401];
  await instance.wake();
  assert.deepEqual(scheduler.delays(), []);
  await instance.wake();
  assert.deepEqual(scheduler.delays(), [30_000]);
  statuses = [422, 201];
  await instance.wake();
  assert.deepEqual(
    (await store.entries()).map((entry) => entry.state),
    ["rejected"],
  );
  assert.deepEqual(scheduler.delays(), []);
});

test("missing and throwing Web Locks allow two tabs to send one key safely", async (context) => {
  for (const throwing of [false, true]) {
    const { store, open, replay } = await fixture(context);
    await store.enqueue("weight", { weight_kg: 70 }, person);
    const entered = deferred<void>();
    const release = deferred<void>();
    const endpoint = server();
    let calls = 0;
    const fetcher: typeof fetch = async (_path, options) => {
      const reply = endpoint.reply(JSON.parse(String(options?.body)));
      if (++calls === 1) {
        entered.resolve();
        await release.promise;
      }
      return reply;
    };
    const options = {
      fetch: fetcher,
      lock: throwing
        ? async () => {
            throw new Error("Locks unavailable");
          }
        : null,
    };
    const first = replay(options);
    const second = replay({ ...options, store: await open() });
    const work = first.wake();
    await entered.promise;
    await second.wake();
    release.resolve();
    await work;
    assert.equal(calls, 2);
    assert.equal(endpoint.rows.size, 1);
    assert.deepEqual(await store.entries(), []);
  }
});

test("an edit survives a late acknowledgement and duplicate replay retains both bodies for either kind", async (context) => {
  for (const kind of ["intake", "weight"] as const) {
    const { store, open, replay } = await fixture(context);
    const original = await store.enqueue(kind, { note: "Original" }, person);
    const entered = deferred<void>();
    const release = deferred<void>();
    const endpoint = server();
    let calls = 0;
    const instance = replay({
      fetch: async (_path, options) => {
        const reply = endpoint.reply(JSON.parse(String(options?.body)));
        if (++calls === 1) {
          entered.resolve();
          await release.promise;
        }
        return reply;
      },
    });
    const work = instance.wake();
    await entered.promise;
    await store.settle(original, { error_code: "invalid_request" });
    const [rejected] = await store.entries();
    assert.ok(rejected);
    await store.edit(rejected, { note: undefined, value: 200 });
    release.resolve();
    await work;
    const [saved] = await (await open()).entries();
    assert.ok(saved);
    assert.equal(saved.error_code, "already_saved");
    assert.equal(saved.body.note, undefined);
    assert.deepEqual(saved.server_row, {
      ...original.body,
      user_id: person.id,
    });
    assert.equal(await store.edit(saved, {}), false);
    assert.equal(await store.resend(saved), false);
    assert.equal(calls, 2);
  }
});

test("a session bump during a write keeps the acknowledgement and the retry backoff", async (context) => {
  for (const status of [201, 503]) {
    const { store, replay, scheduler } = await fixture(context);
    const queued = await store.enqueue("weight", { note: "Original" }, person);
    await store.settle(queued, { error_code: "invalid_request" });
    const [rejected] = await store.entries();
    assert.ok(rejected);
    await store.edit(rejected, { note: "Edited" });
    const entered = deferred<void>();
    const release = deferred<void>();
    const endpoint = server();
    let calls = 0;
    const instance = replay({
      fetch: async (_path, options) => {
        const body = JSON.parse(String(options?.body));
        calls++;
        entered.resolve();
        await release.promise;
        if (status === 503) return json({ error: { code: "down" } }, 503);
        return endpoint.reply(body);
      },
    });
    const work = instance.wake();
    await entered.promise;
    await store.cacheSession((await store.session()).version, session());
    release.resolve();
    await work;
    assert.equal(calls, 1);
    assert.deepEqual(
      (await store.entries()).map((entry) => entry.state),
      status === 503 ? ["pending"] : [],
    );
    assert.deepEqual(scheduler.delays(), status === 503 ? [30_000] : []);
  }
});

test("enqueue, resend and the online event wake the replayer", async (context) => {
  const { store, replay } = await fixture(context);
  const events = new EventTarget();
  const endpoint = server();
  let online = false;
  let reject = false;
  const sent: string[] = [];
  const instance = replay({
    events,
    online: () => online,
    fetch: async (path, options) => {
      sent.push(String(path));
      const body = JSON.parse(String(options?.body));
      return reject
        ? json({ error: { code: "invalid_entry" } }, 422)
        : endpoint.reply(body);
    },
  });
  const until = (check: (snapshot: QueueSnapshot) => boolean) =>
    new Promise<void>((resolve) => {
      const stop = instance.subscribe((snapshot) => {
        if (!check(snapshot)) return;
        stop();
        resolve();
      });
    });
  const drained = (count: number) =>
    until(
      (snapshot) =>
        sent.length === count &&
        snapshot.type === "ready" &&
        snapshot.session.session !== null &&
        snapshot.records.length === 0,
    );
  await instance.start();
  await instance.enqueue("intake", {}, person);
  await until(
    (snapshot) =>
      snapshot.type === "ready" && snapshot.last_pass?.type === "offline",
  );
  online = true;
  events.dispatchEvent(new Event("online"));
  await drained(1);
  await instance.enqueue("weight", {}, person);
  await drained(2);
  reject = true;
  await instance.enqueue("intake", {}, person);
  await until(
    (snapshot) => snapshot.type === "ready" && snapshot.rejected === 1,
  );
  reject = false;
  const [rejected] = await store.entries();
  assert.ok(rejected && (await instance.resend(rejected)));
  await drained(4);
  assert.deepEqual(sent, [
    "/api/intake",
    "/api/weights",
    "/api/intake",
    "/api/intake",
  ]);
});

test("external abort releases the lock, publishes nothing and suppresses a queued rerun", async (context) => {
  const { store, replay, scheduler } = await fixture(context);
  await store.enqueue("intake", {}, person);
  await store.persistence();
  const entered = deferred<void>();
  let released = false;
  let acquired = 0;
  let reads = 0;
  let publications = 0;
  const initial = deferred<void>();
  const instance = replay({
    readSession: async (signal) => {
      reads++;
      entered.resolve();
      return new Promise((resolve) =>
        signal.addEventListener("abort", () => resolve({ type: "aborted" }), {
          once: true,
        }),
      );
    },
    lock: async (_signal, run) => {
      acquired++;
      try {
        return await run();
      } finally {
        released = true;
      }
    },
  });
  instance.subscribe(() => {
    publications++;
    initial.resolve();
  });
  await initial.promise;
  const controller = new AbortController();
  const work = instance.wake(controller.signal);
  await entered.promise;
  void instance.wake();
  controller.abort();
  await work;
  assert.equal(released, true);
  assert.equal(acquired, 1);
  assert.equal(reads, 1);
  assert.equal(publications, 1);
  assert.deepEqual(scheduler.delays(), []);
  assert.equal((await store.entries()).length, 1);
});

test("late session success, sign-out and transport error never replace a bumped empty or populated cache", async (context) => {
  for (const populated of [false, true])
    for (const outcome of [
      { type: "person", session: session(other) },
      { type: "signed_out" },
      { type: "retry" },
    ] satisfies SessionOutcome[]) {
      const { store, replay, scheduler } = await fixture(context);
      if (populated) await store.cacheSession(0, session());
      await store.enqueue("intake", {}, person);
      const entered = deferred<void>();
      const result = deferred<SessionOutcome>();
      let online = true;
      let installs = 0;
      const instance = replay({
        online: () => online,
        readSession: async () => {
          entered.resolve();
          return result.promise;
        },
        onSession: () => {
          installs++;
        },
        fetch: async () => {
          throw new Error("Stale write");
        },
      });
      const work = instance.wake();
      await entered.promise;
      const newer = await store.bumpSession();
      online = false;
      result.resolve(outcome);
      await work;
      assert.deepEqual(await store.session(), newer);
      assert.equal(installs, 0);
      assert.deepEqual(scheduler.delays(), []);
      const snapshot = await instance.snapshot();
      assert.equal(snapshot.type === "ready" && snapshot.last_pass, null);
    }
});

test("storage failures remain visible and broadcast receivers reread without replay or echo", async (context) => {
  const { store, open, replay, scheduler } = await fixture(context);
  await store.cacheSession(0, session());
  const channel = Object.assign(new EventTarget(), {
    postMessage: () => {
      broadcasts++;
    },
  });
  let broadcasts = 0;
  const instance = replay({
    channel,
    fetch: async () => {
      throw new Error("Network down");
    },
  });
  await store.enqueue("intake", {}, person);
  assert.equal(broadcasts, 1);
  await instance.wake();
  const current = deferred<void>();
  const published = deferred<void>();
  instance.subscribe((snapshot) => {
    if (snapshot.type !== "ready") return;
    if (snapshot.pending === 1) current.resolve();
    if (snapshot.pending === 2) published.resolve();
  });
  await current.promise;
  await (await open()).enqueue("weight", {}, person);
  const before = broadcasts;
  channel.dispatchEvent(new Event("message"));
  await published.promise;
  assert.equal(broadcasts, before);
  assert.deepEqual(scheduler.delays(), [30_000]);
  store.close();
  await instance.wake();
  assert.equal((await instance.snapshot()).type, "storage_error");
  assert.deepEqual(scheduler.delays(), [60_000]);
});
