import "fake-indexeddb/auto";
import type { TestContext } from "node:test";
import { deleteDB } from "idb";
import type { Session } from "../src/api.ts";
import type { Scheduler } from "../src/outbox-http.ts";
import { OutboxReplay } from "../src/outbox-replay.ts";
import {
  type EntryBody,
  type OutboxStore,
  openOutboxStore,
} from "../src/outbox-store.ts";

export const person = { id: 1, username: "example-person" };
export const other = { id: 2, username: "example-other" };
export const session = (user = person): Session => ({ mode: "fallback", user });
export const json = (body: unknown, status = 200) =>
  Response.json(body, { status });
export const deferred = <Value,>() => Promise.withResolvers<Value>();
export const acknowledgement = (
  body: EntryBody,
  created: boolean,
  userId = person.id,
) =>
  json({ created, entry: { ...body, user_id: userId } }, created ? 201 : 200);
/** Write endpoints are keyed by client_id: repeat requests return the first stored body. */
export function server() {
  const rows = new Map<string, EntryBody>();
  return {
    rows,
    reply(body: EntryBody) {
      const key = String(body.client_id);
      const created = !rows.has(key);
      if (created) rows.set(key, body);
      return acknowledgement(rows.get(key) ?? body, created);
    },
  };
}
export class ManualScheduler implements Scheduler {
  tasks = new Map<object, { callback: () => void; delay: number }>();
  schedule(callback: () => void, delay: number) {
    const token = {};
    this.tasks.set(token, { callback, delay });
    return token;
  }
  cancel(token: unknown) {
    this.tasks.delete(token as object);
  }
  fire() {
    const next = this.tasks.entries().next().value;
    if (!next) throw new Error("No scheduled task");
    this.tasks.delete(next[0]);
    next[1].callback();
  }
  delays() {
    return [...this.tasks.values()].map((task) => task.delay);
  }
}
export async function fixture(context: TestContext) {
  const name = crypto.randomUUID();
  const stores: OutboxStore[] = [];
  const replayers: OutboxReplay[] = [];
  const scheduler = new ManualScheduler();
  const open = async () => {
    const store = await openOutboxStore({
      name,
      persist: async () => true,
      clock: () => new Date("2026-01-01T06:00:00.000Z"),
    });
    stores.push(store);
    return store;
  };
  const store = await open();
  const replay = (
    options: Partial<ConstructorParameters<typeof OutboxReplay>[0]> = {},
  ) => {
    const instance = new OutboxReplay({
      store,
      scheduler,
      lock: null,
      channel: null,
      events: null,
      readSession: async () => ({ type: "person", session: session() }),
      ...options,
    });
    replayers.push(instance);
    return instance;
  };
  context.after(async () => {
    for (const instance of replayers) await instance.close();
    for (const current of stores) current.close();
    await deleteDB(name);
  });
  return { store, open, replay, scheduler };
}
