import {
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  openDB,
} from "idb";
import { z } from "zod";
import type { Session } from "./api.ts";

const bodySchema = z.record(z.string(), z.json());
export type EntryBody = z.infer<typeof bodySchema>;
export type JsonValue = EntryBody[string];
export type EntryKind = "intake" | "weight";
type StoredEntry = {
  client_id: string;
  kind: EntryKind;
  person_id: number;
  body: EntryBody;
  state: "pending" | "rejected";
  revision: number;
  error_code?: string;
  server_row?: EntryBody;
};
export type QueueEntry = StoredEntry & { seq: number };
export type SessionCache = {
  session: Session | null;
  version: number;
  persistent?: boolean;
};
export type Rejection = { error_code: string; server_row?: EntryBody };
interface OutboxSchema extends DBSchema {
  entries: {
    key: number;
    value: StoredEntry;
    indexes: { client_id: string; person_id: number };
  };
  session: { key: string; value: SessionCache };
}
type StoreOptions = {
  name?: string;
  clock?: () => Date;
  crypto?: Pick<Crypto, "getRandomValues"> &
    Partial<Pick<Crypto, "randomUUID">>;
  persist?: () => Promise<boolean>;
};

function clientId(crypto: NonNullable<StoreOptions["crypto"]>): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const hex = Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (byte, index) => {
      const value =
        index === 6 ? (byte & 15) | 64 : index === 8 ? (byte & 63) | 128 : byte;
      return value.toString(16).padStart(2, "0");
    },
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function requireTime(kind: EntryKind, body: EntryBody) {
  const time = body[kind === "intake" ? "eaten_at" : "measured_at"];
  if (typeof time !== "string" || time.length === 0)
    throw new Error("Event time required");
}

function requireCache(cache: SessionCache | undefined): SessionCache {
  if (!cache) throw new Error("Session cache missing");
  return cache;
}

export async function openOutboxStore(options: StoreOptions = {}) {
  const database = await openDB<OutboxSchema>(
    options.name ?? "tare-outbox",
    1,
    {
      upgrade(database) {
        const entries = database.createObjectStore("entries", {
          autoIncrement: true,
        });
        entries.createIndex("client_id", "client_id", { unique: true });
        entries.createIndex("person_id", "person_id");
        database
          .createObjectStore("session")
          .put({ session: null, version: 0 }, "current");
      },
    },
  );
  return new OutboxStore(database, options);
}

export class OutboxStore {
  #database: IDBPDatabase<OutboxSchema>;
  #options: StoreOptions;
  #events = new EventTarget();

  constructor(database: IDBPDatabase<OutboxSchema>, options: StoreOptions) {
    this.#database = database;
    this.#options = options;
  }

  close() {
    this.#database.close();
  }

  subscribe(listener: () => void) {
    this.#events.addEventListener("change", listener);
    return () => this.#events.removeEventListener("change", listener);
  }

  async entries(personId?: number): Promise<QueueEntry[]> {
    const transaction = this.#database.transaction("entries");
    const source =
      personId === undefined
        ? transaction.store
        : transaction.store.index("person_id");
    let cursor = await source.openCursor(personId);
    const entries: QueueEntry[] = [];
    while (cursor) {
      entries.push({ ...cursor.value, seq: cursor.primaryKey });
      cursor = await cursor.continue();
    }
    await transaction.done;
    return entries;
  }

  async session(): Promise<SessionCache> {
    return requireCache(await this.#database.get("session", "current"));
  }

  async enqueue(kind: EntryKind, fields: EntryBody, person: Session["user"]) {
    if (Object.hasOwn(fields, "client_id"))
      throw new Error("Client id is assigned by the queue");
    const client_id = clientId(this.#options.crypto ?? globalThis.crypto);
    const body = bodySchema.parse({ ...fields, client_id });
    const timeField = kind === "intake" ? "eaten_at" : "measured_at";
    if (body[timeField] === undefined)
      body[timeField] = (this.#options.clock?.() ?? new Date()).toISOString();
    requireTime(kind, body);
    let persistent = (await this.session()).persistent === true;
    if (!persistent) {
      try {
        persistent = this.#options.persist
          ? await this.#options.persist()
          : globalThis.navigator?.storage
            ? await navigator.storage.persist()
            : false;
      } catch {
        persistent = false;
      }
    }
    const record: StoredEntry = {
      client_id,
      kind,
      person_id: person.id,
      body,
      state: "pending",
      revision: 0,
    };
    const seq = await this.#write(
      ["entries", "session"],
      async (transaction) => {
        const cache = requireCache(
          await transaction.objectStore("session").get("current"),
        );
        const seq = await transaction.objectStore("entries").add(record);
        await transaction
          .objectStore("session")
          .put(
            { ...cache, persistent: cache.persistent === true || persistent },
            "current",
          );
        return seq;
      },
    );
    this.#events.dispatchEvent(new Event("change"));
    return { ...record, seq };
  }

  async edit(entry: QueueEntry, patch: Record<string, JsonValue | undefined>) {
    return this.#mutate(entry, (record) => {
      if (record.state !== "rejected" || record.error_code === "already_saved")
        return false;
      if (Object.hasOwn(patch, "client_id"))
        throw new Error("Client id cannot change");
      const body = { ...record.body };
      for (const [field, value] of Object.entries(patch)) {
        if (value === undefined) delete body[field];
        else body[field] = value;
      }
      requireTime(record.kind, body);
      record.body = bodySchema.parse(body);
      record.revision++;
      record.state = "pending";
      delete record.error_code;
      delete record.server_row;
      return record;
    });
  }

  async resend(entry: QueueEntry) {
    return this.#mutate(entry, (record) => {
      if (record.state !== "rejected" || record.error_code === "already_saved")
        return false;
      record.state = "pending";
      delete record.error_code;
      delete record.server_row;
      return record;
    });
  }

  async discard(entry: QueueEntry) {
    return this.#mutate(entry, () => null);
  }

  async settle(entry: QueueEntry, rejection?: Rejection) {
    return this.#mutate(entry, (record) => {
      if (record.state !== "pending") return false;
      if (!rejection) return null;
      if (rejection.error_code === "already_saved" && !rejection.server_row)
        throw new Error("Stored entry required");
      return { ...record, ...rejection, state: "rejected" };
    });
  }

  async #mutate(
    entry: QueueEntry,
    change: (record: StoredEntry) => StoredEntry | null | false,
  ) {
    const changed = await this.#write(["entries"], async (transaction) => {
      const store = transaction.objectStore("entries");
      const current = await store.get(entry.seq);
      if (
        !current ||
        current.state !== entry.state ||
        current.revision !== entry.revision ||
        current.client_id !== entry.client_id ||
        current.person_id !== entry.person_id
      )
        return false;
      const updated = change(current);
      if (updated === null) await store.delete(entry.seq);
      else if (updated !== false) await store.put(updated, entry.seq);
      return updated !== false;
    });
    if (changed) this.#events.dispatchEvent(new Event("change"));
    return changed;
  }

  cacheSession(expectedVersion: number, session: Session | null) {
    return this.#updateSession(expectedVersion, session);
  }

  clearSession() {
    return this.#updateSession(undefined, null);
  }

  bumpSession() {
    return this.#updateSession(undefined, undefined);
  }

  async #updateSession(
    expectedVersion: number | undefined,
    session: Session | null | undefined,
  ) {
    const updated = await this.#write(["session"], async (transaction) => {
      const store = transaction.objectStore("session");
      const cache = requireCache(await store.get("current"));
      if (expectedVersion !== undefined && cache.version !== expectedVersion)
        return null;
      const updated = {
        ...cache,
        session: session === undefined ? cache.session : session,
        version: cache.version + 1,
      };
      await store.put(updated, "current");
      return updated;
    });
    if (updated) this.#events.dispatchEvent(new Event("change"));
    return updated;
  }

  async #write<Result, Stores extends ("entries" | "session")[]>(
    stores: Stores,
    change: (
      transaction: IDBPTransaction<OutboxSchema, Stores, "readwrite">,
    ) => Promise<Result>,
  ): Promise<Result> {
    const transaction = this.#database.transaction(stores, "readwrite");
    try {
      const result = await change(transaction);
      await transaction.done;
      return result;
    } catch (error) {
      // A failed request can already have aborted the transaction.
      let failure = error;
      try {
        transaction.abort();
      } catch (abortError) {
        if (
          !(
            abortError instanceof DOMException &&
            abortError.name === "InvalidStateError"
          )
        )
          failure = new AggregateError(
            [error, abortError],
            "Outbox transaction failed",
          );
      }
      await transaction.done.catch(() => undefined);
      throw failure;
    }
  }
}
