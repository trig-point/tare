import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { deleteDB } from "idb";
import {
  type EntryBody,
  type OutboxStore,
  openOutboxStore,
} from "../src/outbox-store.ts";
import { test } from "./support.mts";

const person = { id: 1, username: "example-person" };
const other = { id: 2, username: "example-other" };
const session = { user: person, mode: "fallback" as const };
async function fixture(
  context: TestContext,
  options: Parameters<typeof openOutboxStore>[0] = {},
) {
  const name = crypto.randomUUID();
  const stores: OutboxStore[] = [];
  const open = async () => {
    const store = await openOutboxStore({
      persist: async () => true,
      ...options,
      name,
    });
    stores.push(store);
    return store;
  };
  context.after(async () => {
    for (const store of stores) store.close();
    await deleteDB(name);
  });
  return { store: await open(), open, name };
}

test("enqueue commits ordered person-bound snapshots and retries persistent storage until granted", async (context) => {
  let calls = 0;
  let now = new Date("2026-01-01T06:00:00.000Z");
  const { store, open } = await fixture(context, {
    clock: () => now,
    crypto: { getRandomValues: crypto.getRandomValues.bind(crypto) },
    persist: async () => {
      calls++;
      if (calls === 2) throw new Error("Unavailable");
      return calls === 3;
    },
  });
  assert.deepEqual(await store.entries(), []);
  assert.deepEqual(await store.session(), { session: null, version: 0 });
  const first = await store.enqueue("intake", { kcal: 100 }, person);
  await store.persistence();
  assert.match(
    first.client_id,
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  now = new Date("2026-01-01T14:00:00.000Z");
  assert.equal(first.body.eaten_at, "2026-01-01T06:00:00.000Z");
  first.body.kcal = 900;
  assert.equal((await store.entries())[0]?.body.kcal, 100);
  store.close();
  const reopened = await open();
  assert.equal((await reopened.session()).persistent, false);
  await reopened.enqueue(
    "weight",
    { weight_kg: 70, measured_at: "2026-01-01T05:00:00.000Z" },
    other,
  );
  await reopened.persistence();
  await reopened.enqueue("intake", { kcal: 200 }, person);
  await reopened.persistence();
  await reopened.enqueue("intake", { kcal: 300 }, person);
  const records = await reopened.entries();
  assert.deepEqual(
    records.map((record) => record.seq),
    [1, 2, 3, 4],
  );
  assert.equal(new Set(records.map((record) => record.client_id)).size, 4);
  assert.equal(records[0]?.body.eaten_at, "2026-01-01T06:00:00.000Z");
  assert.equal(records[1]?.body.measured_at, "2026-01-01T05:00:00.000Z");
  assert.deepEqual(
    (await reopened.entries(other.id)).map((record) => record.seq),
    [2],
  );
  assert.equal((await reopened.session()).persistent, true);
  assert.equal(calls, 3);
});

test("enqueue commits and resolves without waiting for the persistent-storage answer", async (context) => {
  let markAsked = () => {};
  const asked = new Promise<void>((resolve) => {
    markAsked = resolve;
  });
  let answer = (_granted: boolean) => {};
  let calls = 0;
  const { store, open } = await fixture(context, {
    persist: () => {
      calls++;
      markAsked();
      return new Promise((resolve) => {
        answer = resolve;
      });
    },
  });
  const observer = await open();
  const first = await Promise.race([
    store.enqueue("intake", { kcal: 100 }, person),
    asked.then(() => undefined),
  ]);
  assert.ok(
    first,
    "persistent storage was requested before the entry committed",
  );
  await asked;
  await store.enqueue("weight", { weight_kg: 70 }, person);
  assert.equal(calls, 1);
  assert.equal((await observer.entries()).length, 2);
  assert.equal((await observer.session()).persistent, undefined);
  answer(true);
  assert.equal(await store.persistence(), true);
  assert.equal((await observer.session()).persistent, true);
});

test("failed inserts and malformed input leave the durable queue and notifications unchanged", async (context) => {
  const { store, open } = await fixture(context, {
    crypto: {
      randomUUID: () => "00000000-0000-4000-8000-000000000000",
      getRandomValues: crypto.getRandomValues.bind(crypto),
    },
  });
  const observer = await open();
  const notifications: Promise<unknown>[] = [];
  const unsubscribe = store.subscribe(() => {
    notifications.push(observer.entries());
  });
  const first = await store.enqueue("intake", {}, person);
  await store.persistence();
  assert.deepEqual(await notifications[0], [first]);
  await assert.rejects(store.enqueue("weight", {}, other), {
    name: "ConstraintError",
  });
  const malformed: EntryBody[] = [
    { client_id: "caller-supplied" },
    { eaten_at: "" },
    { kcal: Number.NaN },
  ];
  for (const fields of malformed)
    await assert.rejects(store.enqueue("intake", fields, person));
  const { put } = IDBObjectStore.prototype;
  IDBObjectStore.prototype.put = function (...args) {
    const request = put.apply(this, args);
    request.addEventListener("success", () => request.transaction?.abort());
    return request;
  };
  try {
    await assert.rejects(store.bumpSession(), { name: "AbortError" });
  } finally {
    IDBObjectStore.prototype.put = put;
  }
  assert.equal((await observer.session()).version, 0);
  assert.equal((await observer.entries()).length, 1);
  assert.equal(notifications.length, 2);
  unsubscribe();
  await store.clearSession();
  assert.equal(notifications.length, 2);
});

test("revision checks preserve edits against late acknowledgements and already_saved survives reload", async (context) => {
  const { store, open } = await fixture(context);
  const peer = await open();
  for (const kind of ["intake", "weight"] as const) {
    const time = kind === "intake" ? "eaten_at" : "measured_at";
    const value = kind === "intake" ? "kcal" : "weight_kg";
    const optional = kind === "intake" ? "portion_note" : "body_fat_pct";
    const fields: EntryBody =
      kind === "intake"
        ? { name: "Example snack", kcal: 100, portion_note: "Half" }
        : { weight_kg: 70, body_fat_pct: 18 };
    const original = await store.enqueue(kind, fields, person);
    assert.equal(await store.edit(original, { [value]: 20 }), false);
    assert.equal(await store.resend(original), false);
    assert.equal(await store.discard(original), false);
    for (const rejection of [
      { error_code: "already_saved" },
      { error_code: "invalid_request", server_row: {} },
    ])
      await assert.rejects(store.settle(original, rejection));
    await store.settle(original, { error_code: "invalid_request" });
    let [rejected] = await store.entries();
    assert.ok(rejected);
    assert.equal(await store.resend(rejected), true);
    let [resent] = await store.entries();
    assert.ok(resent);
    assert.equal(resent.revision, 0);
    await store.settle(resent, { error_code: "invalid_request" });
    [rejected] = await store.entries();
    assert.ok(rejected);
    for (const patch of [{ [time]: undefined }, { client_id: "replacement" }])
      await assert.rejects(store.edit(rejected, patch));
    const edits = await Promise.all([
      store.edit(rejected, { [value]: 20, [optional]: undefined }),
      peer.edit(rejected, { [value]: 30, [optional]: undefined }),
    ]);
    assert.equal(edits.filter(Boolean).length, 1);
    [resent] = await store.entries();
    assert.ok(resent);
    assert.equal(resent.revision, 1);
    assert.equal(resent.body[value], edits[0] ? 20 : 30);
    assert.equal(Object.hasOwn(resent.body, optional), false);
    assert.equal(resent.body[time], original.body[time]);
    assert.equal(await store.settle(original), false);
    assert.equal(await store.discard(rejected), false);
    const serverRow = { ...original.body, id: 1, user_id: person.id };
    await store.settle(resent, {
      error_code: "already_saved",
      server_row: serverRow,
    });
    const reloaded = await open();
    const [saved] = await reloaded.entries();
    assert.ok(saved);
    assert.equal(saved.error_code, "already_saved");
    assert.deepEqual(saved.server_row, serverRow);
    assert.deepEqual(saved.body, resent.body);
    assert.equal(await reloaded.edit(saved, { [value]: 40 }), false);
    assert.equal(await reloaded.resend(saved), false);
    assert.equal(await reloaded.discard(saved), true);
    assert.equal(await reloaded.discard(saved), false);
    reloaded.close();
  }
  assert.deepEqual(await store.entries(), []);
});

test("session compare-and-write rejects stale results and clearing or resetting keeps a distinct empty state", async (context) => {
  for (const populated of [false, true]) {
    const { store, open, name } = await fixture(context);
    const peer = await open();
    if (populated) await store.cacheSession(0, session);
    const captured = await store.session();
    const newer = await store.bumpSession();
    assert.deepEqual(newer?.session, captured.session);
    for (const stale of [session, null])
      assert.equal(await peer.cacheSession(captured.version, stale), null);
    const version = (await store.session()).version;
    const writes = await Promise.all([
      store.cacheSession(version, session),
      peer.cacheSession(version, { user: other, mode: "fallback" }),
    ]);
    assert.equal(writes.filter(Boolean).length, 1);
    assert.equal((await store.session()).version, version + 1);
    await store.enqueue("intake", {}, person);
    const cleared = await peer.clearSession();
    assert.equal(cleared?.session, null);
    assert.equal(await store.cacheSession(version + 1, session), null);
    assert.equal((await store.entries()).length, 1);
    store.close();
    peer.close();
    await deleteDB(name);
    const reset = await open();
    assert.deepEqual(await reset.entries(), []);
    assert.deepEqual(await reset.session(), { session: null, version: 0 });
  }
});
