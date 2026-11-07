import { z as schema } from "zod";
import { request, type Session, sessionSchema } from "./api.ts";
import type { EntryBody, QueueEntry } from "./outbox-store.ts";

export type SessionOutcome =
  | { type: "person"; session: Session }
  | { type: "signed_out" | "sign_in_needed" | "retry" | "offline" | "aborted" };
export type WriteOutcome =
  | { type: "acknowledged"; created: boolean; entry: EntryBody }
  | { type: "rejected"; error_code: string }
  | { type: "retry"; identity?: true }
  | { type: "sign_in_needed" | "aborted" };
export type Scheduler = {
  schedule(callback: () => void, delay: number): unknown;
  cancel(token: unknown): void;
};
export const browserScheduler: Scheduler = {
  schedule: (callback, delay) => globalThis.setTimeout(callback, delay),
  cancel: (token) =>
    globalThis.clearTimeout(token as ReturnType<typeof setTimeout>),
};
export type TransportOptions = {
  fetch?: typeof fetch;
  online?: () => boolean;
  scheduler?: Scheduler;
  deadline?: number;
};
const redirects = new Set([301, 302, 303, 307, 308]);
const acknowledgment = schema.object({
  entry: schema.record(schema.string(), schema.json()),
  created: schema.boolean(),
});
const errorBody = schema.object({
  error: schema.object({ code: schema.string().min(1) }),
});
const retryStatus = (status: number) =>
  status >= 500 || [408, 429].includes(status);
const isRedirect = (response: Response) =>
  response.type === "opaqueredirect" || redirects.has(response.status);
export const browserOnline = () => globalThis.navigator?.onLine !== false;

async function json(
  response: Response,
): Promise<{ valid: true; body: unknown } | { valid: false }> {
  const text = await response.text();
  if (!response.headers.get("Content-Type")?.includes("application/json"))
    return { valid: false };
  try {
    return { valid: true, body: JSON.parse(text) };
  } catch {
    return { valid: false };
  }
}

async function deadline<Result>(
  work: (signal: AbortSignal) => Promise<Result>,
  options: TransportOptions,
  external?: AbortSignal,
): Promise<Result | { type: "retry" | "aborted" }> {
  if (external?.aborted) return { type: "aborted" };
  const scheduler = options.scheduler ?? browserScheduler;
  const controller = new AbortController();
  let aborted = () => {};
  let timer: unknown;
  try {
    return await new Promise((resolve) => {
      aborted = () => {
        controller.abort();
        resolve({ type: "aborted" });
      };
      external?.addEventListener("abort", aborted, { once: true });
      timer = scheduler.schedule(() => {
        controller.abort();
        resolve({ type: "retry" });
      }, options.deadline ?? 15_000);
      work(controller.signal).then(resolve, () =>
        resolve({ type: external?.aborted ? "aborted" : "retry" }),
      );
    });
  } finally {
    scheduler.cancel(timer);
    external?.removeEventListener("abort", aborted);
  }
}

export async function readSessionOutcome(
  options: TransportOptions = {},
  signal?: AbortSignal,
): Promise<SessionOutcome> {
  if (!(options.online ?? browserOnline)()) return { type: "offline" };
  return deadline(
    async (signal): Promise<SessionOutcome> => {
      const response = await request("/api/session", { signal }, options.fetch);
      if (isRedirect(response)) return { type: "sign_in_needed" };
      if (response.type === "error" || retryStatus(response.status))
        return { type: "retry" };
      const fallback =
        response.status === 401 &&
        response.headers.get("X-Tare-Auth-Mode") === "fallback";
      if ((response.status === 401 && !fallback) || response.status === 403)
        return { type: "sign_in_needed" };
      if (!response.ok && !fallback) return { type: "retry" };
      const result = await json(response);
      if (!result.valid) return { type: "sign_in_needed" };
      if (fallback) {
        const parsed = errorBody.safeParse(result.body);
        return {
          type:
            parsed.success && parsed.data.error.code === "unauthenticated"
              ? "signed_out"
              : "sign_in_needed",
        };
      }
      const parsed = sessionSchema.safeParse(result.body);
      return parsed.success
        ? { type: "person", session: parsed.data }
        : { type: "sign_in_needed" };
    },
    options,
    signal,
  );
}

export async function writeEntry(
  entry: QueueEntry,
  options: TransportOptions = {},
  signal?: AbortSignal,
): Promise<WriteOutcome> {
  return deadline(
    async (signal): Promise<WriteOutcome> => {
      const response = await request(
        entry.kind === "intake" ? "/api/intake" : "/api/weights",
        {
          method: "POST",
          signal,
          headers: { "X-Tare-Person": String(entry.person_id) },
          body: JSON.stringify(entry.body),
        },
        options.fetch,
      );
      if (isRedirect(response)) return { type: "sign_in_needed" };
      if (response.type === "error" || retryStatus(response.status))
        return { type: "retry" };
      if (response.status === 401) return { type: "sign_in_needed" };
      const result = await json(response);
      if (!result.valid) return { type: "sign_in_needed" };
      if (response.ok) {
        const parsed = acknowledgment.safeParse(result.body);
        return parsed.success &&
          parsed.data.entry.client_id === entry.client_id &&
          parsed.data.entry.user_id === entry.person_id
          ? { type: "acknowledged", ...parsed.data }
          : { type: "retry" };
      }
      if (response.status < 400 || response.status >= 500)
        return { type: "retry" };
      const parsed = errorBody.safeParse(result.body);
      const code = parsed.success
        ? parsed.data.error.code
        : `http_${response.status}`;
      if (
        (response.status === 409 && code === "person_mismatch") ||
        (response.status === 403 && code === "not_a_member")
      )
        return { type: "retry", identity: true };
      return { type: "rejected", error_code: code };
    },
    options,
    signal,
  );
}
