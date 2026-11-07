import type { Session } from "./api.ts";
import type { QueueSnapshot } from "./outbox-replay.ts";
import type { SessionState } from "./outbox-session.ts";

export function outboxView(
  state: SessionState | undefined,
  queue: QueueSnapshot | null,
  online: boolean,
  failed = false,
) {
  const ready = queue?.type === "ready" ? queue : null;
  const current =
    !ready || (state && state.version >= ready.session.version)
      ? state?.outcome
      : undefined;
  const live = current?.type === "person" ? current.session : null;
  const session: Session | null =
    current?.type === "signed_out"
      ? null
      : (live ?? ready?.session.session ?? null);
  const records =
    ready?.records.filter((entry) => entry.person_id === session?.user.id) ??
    [];
  const pending = records.filter((entry) => entry.state === "pending").length;
  const rejected = records.filter((entry) => entry.state === "rejected").length;
  const last = ready?.last_pass;
  const offline =
    !online || current?.type === "offline" || last?.type === "offline";
  const signIn =
    current?.type === "sign_in_needed" || last?.type === "sign_in_needed";
  const retry =
    failed ||
    queue?.type === "storage_error" ||
    current?.type === "retry" ||
    last?.type === "retry";
  const screen = offline
    ? session
      ? "app"
      : "offline"
    : current?.type === "signed_out"
      ? "signed_out"
      : session
        ? "app"
        : signIn
          ? "sign_in_needed"
          : retry
            ? "outage"
            : "loading";
  const status = offline
    ? "Offline"
    : signIn
      ? "Sign in needed"
      : retry
        ? "Couldn’t sync"
        : pending
          ? `${pending} pending`
          : rejected
            ? `${rejected} rejected`
            : ready
              ? "Synced"
              : "Loading...";
  return {
    screen,
    session,
    records,
    pending,
    rejected,
    status,
    signIn: !offline && signIn,
    storageWarning: ready?.storage_warning ?? false,
  };
}
