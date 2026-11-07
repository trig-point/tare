import {
  CancelledError,
  isCancelledError,
  type QueryClient,
} from "@tanstack/react-query";
import { api, endSession, type Session, signOutTarget } from "./api.ts";
import {
  readSessionOutcome,
  type SessionOutcome,
  type TransportOptions,
} from "./outbox-http.ts";
import type { OutboxStore } from "./outbox-store.ts";

export const sessionKey = ["session"];
export type SessionState = { outcome: SessionOutcome; version: number };
export class OutboxSession {
  #store: OutboxStore;
  #client: QueryClient;
  #transport: TransportOptions;
  wake = () => {};
  constructor(
    store: OutboxStore,
    client: QueryClient,
    transport: TransportOptions = {},
  ) {
    this.#store = store;
    this.#client = client;
    this.#transport = transport;
  }
  query(wake = true) {
    return {
      queryKey: sessionKey,
      retry: false as const,
      networkMode: "always" as const,
      refetchOnReconnect: "always" as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.#read(signal, wake),
    };
  }
  async #read(signal: AbortSignal, wake: boolean): Promise<SessionState> {
    const captured = await this.#store.session();
    const outcome = await readSessionOutcome(this.#transport, signal);
    if (signal.aborted || outcome.type === "aborted")
      throw new CancelledError({ silent: true });
    let version = captured.version;
    if (outcome.type === "person" || outcome.type === "signed_out") {
      const cache = await this.#store.cacheSession(
        version,
        outcome.type === "person" ? outcome.session : null,
      );
      if (!cache) throw new CancelledError({ silent: true });
      version = cache.version;
    }
    if (signal.aborted || (await this.#store.session()).version !== version)
      throw new CancelledError({ silent: true });
    if (wake && outcome.type === "person") this.wake();
    return { outcome, version };
  }
  async accept(outcome: SessionOutcome, version: number) {
    if (
      outcome.type === "aborted" ||
      (await this.#store.session()).version !== version
    )
      return false;
    await this.#client.cancelQueries({ queryKey: sessionKey });
    if ((await this.#store.session()).version !== version) return false;
    this.#client.setQueryData<SessionState>(sessionKey, { outcome, version });
    return true;
  }
  async refresh(wake = true) {
    try {
      const state = await this.#client.fetchQuery(this.query(wake));
      return (await this.#store.session()).version === state.version
        ? { accepted: true as const, state }
        : { accepted: false as const };
    } catch (error) {
      if (isCancelledError(error)) return { accepted: false as const };
      throw error;
    }
  }
  async identityRefused() {
    const previous = (await this.#store.session()).session?.user.id;
    const result = await this.refresh(false);
    if (
      result.accepted &&
      result.state.outcome.type === "person" &&
      result.state.outcome.session.user.id !== previous
    )
      this.wake();
  }
  async signIn(username: string, password: string) {
    await api("/api/session", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    await this.#store.bumpSession();
    await this.#client.cancelQueries({ queryKey: sessionKey });
    const result = await this.refresh();
    if (!result.accepted || result.state.outcome.type !== "person")
      throw new Error("Session missing");
  }
  async signOut(
    session: Session,
    navigate = (href: string) => window.location.assign(href),
  ) {
    const target = signOutTarget(session);
    if (!("href" in target)) await endSession(target);
    const cache = await this.#store.clearSession();
    if (!cache) throw new Error("Session clear failed");
    await this.accept(
      { type: "href" in target ? "sign_in_needed" : "signed_out" },
      cache.version,
    );
    if (typeof target.href === "string") navigate(target.href);
  }
}
