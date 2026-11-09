import { z } from "zod";

const person = z.object({ id: z.number(), username: z.string() });
export const sessionSchema = z.discriminatedUnion("mode", [
  z.object({ user: person, mode: z.literal("fallback") }),
  z.object({
    user: person,
    mode: z.literal("access"),
    logout_url: z.url(),
  }),
]);
export type Session = z.infer<typeof sessionSchema>;

export class ApiError extends Error {
  status: number;
  constructor(status: number) {
    super(`Request failed (${status})`);
    this.status = status;
  }
}

export async function request(
  path: string,
  options: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("X-Requested-With", "XMLHttpRequest");
  if (options.body !== undefined)
    headers.set("Content-Type", "application/json");
  return fetcher(path, {
    ...options,
    headers,
    credentials: "same-origin",
    redirect: "manual",
  });
}

export async function api(
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  const response = await request(path, options);
  if (!response.ok) throw new ApiError(response.status);
  if (response.status === 204) return undefined;
  if (!response.headers.get("Content-Type")?.includes("application/json"))
    throw new Error("Invalid response");
  return response.json();
}

export type SessionDeletion = { method: "DELETE"; path: string };

export async function endSession(target: SessionDeletion) {
  try {
    await api(target.path, { method: target.method });
  } catch (error) {
    // A 401 means the session has already ended.
    if (!(error instanceof ApiError && error.status === 401)) throw error;
  }
}

export function signOutTarget(session: Session) {
  return session.mode === "access"
    ? { href: session.logout_url }
    : { method: "DELETE" as const, path: "/api/session" };
}

// Tracker syncs write on the server, so an open page polls for them.
export const liveRefresh = {
  refetchInterval: 15 * 60_000,
  refetchOnWindowFocus: true,
} as const;
