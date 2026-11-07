import {
  browserOnline,
  browserScheduler,
  readSessionOutcome,
  type Scheduler,
  type SessionOutcome,
  type TransportOptions,
  writeEntry,
} from "./outbox-http.ts";
import type { OutboxStore, QueueEntry, SessionCache } from "./outbox-store.ts";

export type PassResult = {
  type:
    | "drained"
    | "retry"
    | "sign_in_needed"
    | "signed_out"
    | "offline"
    | "stale"
    | "aborted";
  person_id: number | null;
  session_version: number | null;
  error?: unknown;
};
export type QueueSnapshot =
  | {
      type: "ready";
      records: QueueEntry[];
      pending: number;
      rejected: number;
      session: SessionCache;
      last_pass: PassResult | null;
      storage_warning: boolean;
      channel_error: boolean;
    }
  | { type: "storage_error"; error: unknown };
type Channel = Pick<
  BroadcastChannel,
  "postMessage" | "addEventListener" | "removeEventListener"
>;
type ReplayOptions = TransportOptions & {
  store: OutboxStore;
  lock?:
    | ((
        signal: AbortSignal,
        run: () => Promise<PassResult>,
      ) => Promise<PassResult>)
    | null;
  channel?: Channel | null;
  events?: EventTarget | null;
  readSession?: (signal: AbortSignal) => Promise<SessionOutcome>;
  onSession?: (
    outcome: SessionOutcome,
    version: number,
  ) => void | Promise<void>;
  onIdentityRefused?: () => void | Promise<void>;
};

export class OutboxReplay {
  #options: ReplayOptions;
  #scheduler: Scheduler;
  #channel: Channel | null = null;
  #ownedChannel?: BroadcastChannel;
  #channelError = false;
  #events: EventTarget | null;
  #listeners = new Set<(snapshot: QueueSnapshot) => void>();
  #unsubscribe: () => void;
  #last: PassResult | null = null;
  #publishing = 0;
  #running?: Promise<void>;
  #controller?: AbortController;
  #rerun = false;
  #closed = false;
  #timer: unknown;
  #failures = 0;
  #online = () => {
    void this.wake();
  };
  #receive = () => {
    void this.#publish();
  };

  constructor(options: ReplayOptions) {
    this.#options = options;
    this.#scheduler = options.scheduler ?? browserScheduler;
    this.#events =
      options.events === undefined
        ? typeof window === "undefined"
          ? null
          : window
        : options.events;
    if (options.channel !== undefined) this.#channel = options.channel;
    else if (typeof BroadcastChannel !== "undefined") {
      try {
        this.#ownedChannel = new BroadcastChannel("tare-outbox");
        this.#channel = this.#ownedChannel;
      } catch {
        this.#channelError = true;
      }
    }
    this.#channel?.addEventListener("message", this.#receive);
    this.#unsubscribe = options.store.subscribe(() => {
      try {
        this.#channel?.postMessage("changed");
      } catch {
        this.#channelError = true;
      }
      void this.#publish();
    });
  }

  start() {
    this.#events?.addEventListener("online", this.#online);
    return this.wake();
  }

  subscribe(listener: (snapshot: QueueSnapshot) => void) {
    this.#listeners.add(listener);
    void this.#publish();
    return () => this.#listeners.delete(listener);
  }

  async snapshot(): Promise<QueueSnapshot> {
    try {
      const session = await this.#options.store.session();
      const person = session.session?.user.id ?? null;
      const records =
        person === null ? [] : await this.#options.store.entries(person);
      return {
        type: "ready",
        records,
        pending: records.filter((entry) => entry.state === "pending").length,
        rejected: records.filter((entry) => entry.state === "rejected").length,
        session,
        last_pass:
          this.#last?.person_id === person &&
          this.#last.session_version === session.version
            ? this.#last
            : null,
        storage_warning: session.persistent === false,
        channel_error: this.#channelError,
      };
    } catch (error) {
      return { type: "storage_error", error };
    }
  }

  async #publish() {
    const version = ++this.#publishing;
    const snapshot = await this.snapshot();
    if (version === this.#publishing && !this.#closed)
      for (const listener of this.#listeners) listener(snapshot);
  }

  async enqueue(...args: Parameters<OutboxStore["enqueue"]>) {
    const entry = await this.#options.store.enqueue(...args);
    void this.wake();
    return entry;
  }
  edit(...args: Parameters<OutboxStore["edit"]>) {
    return this.#change(this.#options.store.edit(...args));
  }
  resend(...args: Parameters<OutboxStore["resend"]>) {
    return this.#change(this.#options.store.resend(...args));
  }
  discard(...args: Parameters<OutboxStore["discard"]>) {
    return this.#change(this.#options.store.discard(...args));
  }
  async #change(work: Promise<boolean>) {
    const changed = await work;
    if (changed) void this.wake();
    return changed;
  }

  wake(external?: AbortSignal): Promise<void> {
    if (this.#closed || external?.aborted) return Promise.resolve();
    this.#rerun = true;
    if (this.#running) return this.#running;
    const controller = new AbortController();
    this.#controller = controller;
    const abort = () => controller.abort();
    external?.addEventListener("abort", abort, { once: true });
    this.#running = this.#run(controller.signal).finally(() => {
      external?.removeEventListener("abort", abort);
      this.#running = undefined;
      if (
        this.#rerun &&
        !controller.signal.aborted &&
        !this.#closed &&
        this.#isOnline()
      )
        void this.wake();
    });
    return this.#running;
  }

  async #run(signal: AbortSignal) {
    do {
      this.#rerun = false;
      let entered = false;
      const run = () => {
        entered = true;
        return this.#pass(signal);
      };
      const nativeLock =
        typeof navigator !== "undefined" && navigator.locks
          ? (signal: AbortSignal, run: () => Promise<PassResult>) =>
              navigator.locks.request("tare-outbox", { signal }, run)
          : null;
      const lock =
        this.#options.lock === undefined ? nativeLock : this.#options.lock;
      let result: PassResult;
      try {
        result = lock ? await lock(signal, run) : await run();
      } catch (error) {
        result = signal.aborted
          ? this.#result("aborted")
          : entered
            ? this.#result("retry", undefined, error)
            : await run();
      }
      if (signal.aborted || result.type === "aborted") return;
      if (result.type === "stale") this.#rerun = true;
      else {
        this.#last = result;
        if (
          result.type === "drained" ||
          result.type === "sign_in_needed" ||
          result.type === "signed_out"
        ) {
          this.#cancelTimer();
          this.#failures = 0;
        } else if (result.type === "retry") {
          this.#cancelTimer();
          if (this.#isOnline())
            this.#timer = this.#scheduler.schedule(
              () => {
                this.#timer = undefined;
                void this.wake();
              },
              Math.min(30_000 * 2 ** this.#failures, 900_000),
            );
          this.#failures++;
        }
        await this.#publish();
      }
    } while (
      this.#rerun &&
      this.#isOnline() &&
      !signal.aborted &&
      !this.#closed
    );
  }

  #isOnline() {
    return (this.#options.online ?? browserOnline)();
  }
  #cancelTimer() {
    if (this.#timer !== undefined) this.#scheduler.cancel(this.#timer);
    this.#timer = undefined;
  }
  #result(
    type: PassResult["type"],
    cache?: SessionCache,
    error?: unknown,
  ): PassResult {
    return {
      type,
      person_id: cache?.session?.user.id ?? null,
      session_version: cache?.version ?? null,
      ...(error === undefined ? {} : { error }),
    };
  }

  async #pass(signal: AbortSignal): Promise<PassResult> {
    let cache: SessionCache | undefined;
    try {
      cache = await this.#options.store.session();
      if (
        !(await this.#options.store.entries()).some(
          (entry) => entry.state === "pending",
        )
      )
        return this.#result("drained", cache);
      if (signal.aborted) return this.#result("aborted", cache);
      if (!this.#isOnline()) return this.#result("offline", cache);
      const outcome = await (this.#options.readSession
        ? this.#options.readSession(signal)
        : readSessionOutcome(this.#options, signal)
      ).catch(
        (): SessionOutcome => ({
          type: signal.aborted ? "aborted" : "retry",
        }),
      );
      if (signal.aborted || outcome.type === "aborted")
        return this.#result("aborted", cache);
      if ((await this.#options.store.session()).version !== cache.version)
        return this.#result("stale", cache);
      if (signal.aborted) return this.#result("aborted", cache);
      if (outcome.type === "person" || outcome.type === "signed_out") {
        const updated = await this.#options.store.cacheSession(
          cache.version,
          outcome.type === "person" ? outcome.session : null,
        );
        if (!updated) return this.#result("stale", cache);
        cache = updated;
      }
      if (signal.aborted) return this.#result("aborted", cache);
      await this.#options.onSession?.(outcome, cache.version);
      if (signal.aborted) return this.#result("aborted", cache);
      if ((await this.#options.store.session()).version !== cache.version)
        return this.#result("stale", cache);
      if (outcome.type !== "person") return this.#result(outcome.type, cache);
      const person = outcome.session.user.id;
      for (;;) {
        if (signal.aborted) return this.#result("aborted", cache);
        if ((await this.#options.store.session()).version !== cache.version)
          return this.#result("stale", cache);
        if (!this.#isOnline()) return this.#result("offline", cache);
        const entry = (await this.#options.store.entries(person)).find(
          (record) => record.state === "pending",
        );
        if (!entry) return this.#result("drained", cache);
        const result = await writeEntry(entry, this.#options, signal);
        if (signal.aborted || result.type === "aborted")
          return this.#result("aborted", cache);
        // The server's response stands after a session change: a lost
        // acknowledgement would resend an edit as already_saved, and a lost
        // retry would skip the backoff.
        if (result.type === "acknowledged") {
          await this.#options.store.settle(
            entry,
            !result.created && entry.revision > 0
              ? { error_code: "already_saved", server_row: result.entry }
              : undefined,
          );
        } else if (result.type === "rejected")
          await this.#options.store.settle(entry, {
            error_code: result.error_code,
          });
        else if (result.type === "retry") {
          if (result.identity) await this.#options.onIdentityRefused?.();
          return this.#result("retry", cache);
        } else if (
          (await this.#options.store.session()).version !== cache.version
        )
          return this.#result("stale", cache);
        else return this.#result(result.type, cache);
      }
    } catch (error) {
      return this.#result("retry", cache, error);
    }
  }

  async close() {
    this.#closed = true;
    this.#controller?.abort();
    this.#cancelTimer();
    this.#events?.removeEventListener("online", this.#online);
    this.#channel?.removeEventListener("message", this.#receive);
    this.#ownedChannel?.close();
    this.#unsubscribe();
    await this.#running;
    this.#listeners.clear();
  }
}
