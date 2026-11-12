import { isIP } from "node:net";
import type { Database } from "better-sqlite3";
import { selectUserByUsername } from "../queries/select-user-by-username.ts";

export interface GrocyConfig {
  url: string;
  apiKey: string;
  username: string;
}

export function safeGrocyText(candidate: string, key: string | undefined) {
  if (!key || !candidate.includes(key)) return candidate;
  const fallback = "Grocy operation failed";
  return fallback.includes(key) ? undefined : fallback;
}

export function normalizeGrocyUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TARE_GROCY_URL must be an HTTP or HTTPS root or /api URL");
  }
  if (
    !/^https?:\/\/[^/?#\\]+(?:\/api)?\/?$/i.test(value) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/", "/api", "/api/"].includes(url.pathname)
  )
    throw new Error("TARE_GROCY_URL must be an HTTP or HTTPS root or /api URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const octets = host.split(".").map(Number);
  const privateHost =
    isIP(host) === 4
      ? octets[0] === 127 ||
        octets[0] === 10 ||
        (octets[0] === 172 &&
          Number(octets[1]) >= 16 &&
          Number(octets[1]) <= 31) ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 169 && octets[1] === 254)
      : isIP(host) === 6
        ? host === "::1" || /^(f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/i.test(host)
        : /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(host);
  if (url.protocol !== "https:" && !privateHost)
    throw new Error("TARE_GROCY_URL requires HTTPS outside private hosts");
  return `${url.origin}/api`;
}

export function parseGrocyConfig(
  env: Record<string, string | undefined>,
): GrocyConfig | null {
  const url = env.TARE_GROCY_URL?.trim();
  const apiKey = env.TARE_GROCY_API_KEY?.trim();
  const username = env.TARE_GROCY_USERNAME?.trim();
  if (!url && !apiKey && !username) return null;
  if (!url || !apiKey || !username)
    throw new Error(
      "TARE_GROCY_URL, TARE_GROCY_API_KEY and TARE_GROCY_USERNAME must be set together",
    );
  return { url: normalizeGrocyUrl(url), apiKey, username };
}

export function resolveGrocyOwner(
  database: Database,
  config: GrocyConfig | null,
) {
  if (!config) return null;
  const user = selectUserByUsername(database, { username: config.username });
  if (!user) throw new Error("TARE_GROCY_USERNAME names an unknown username");
  return user.id;
}
