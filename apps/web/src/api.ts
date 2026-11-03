import { z } from "zod";

const person = z.object({ id: z.number(), username: z.string() });
const sessionSchema = z.discriminatedUnion("mode", [
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

export async function api(
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers(options.headers);
  headers.set("X-Requested-With", "XMLHttpRequest");
  if (options.body !== undefined)
    headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
    redirect: "manual",
  });
  if (!response.ok) throw new ApiError(response.status);
  if (response.status === 204) return undefined;
  if (!response.headers.get("Content-Type")?.includes("application/json"))
    throw new Error("Invalid response");
  return response.json();
}

export async function readSession(): Promise<Session | null> {
  try {
    return sessionSchema.parse(await api("/api/session"));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function signOutTarget(session: Session) {
  return session.mode === "access"
    ? { href: session.logout_url }
    : { method: "DELETE" as const, path: "/api/session" };
}
