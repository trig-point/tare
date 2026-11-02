import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { normalizeAccessEmail } from "./auth/access.ts";

export interface Config {
  databaseUrl: string;
  port: number;
  timezone: string;
  publicUrl: string | undefined;
  sessionDays: number;
  backupDir: string | undefined;
  backupKeep: number;
  usdaApiKey: string | undefined;
  offUserAgent: string | undefined;
  identity:
    | { mode: "access"; teamDomain: string; audience: string }
    | { mode: "fallback" };
  firstUser: {
    username: string | undefined;
    password: string | undefined;
    accessEmail?: string;
  };
}

export function validateOffUserAgent(
  value: string | undefined,
): string | undefined {
  const userAgent = value?.trim();
  if (!userAgent) return undefined;
  if (
    !/^[A-Za-z][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._+-]* \([^\s()@]+@[^\s()@]+\.[^\s()@]+\)$/.test(
      userAgent,
    )
  )
    throw new Error(
      "TARE_OFF_USER_AGENT must be AppName/Version (ContactEmail)",
    );
  return userAgent;
}

export function validateTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    if (!timezone || /^[+-]/.test(timezone))
      throw new Error("IANA timezone required");
  } catch {
    throw new Error("TARE_TIMEZONE must be an IANA timezone");
  }
  return timezone;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const portText = env.PORT ?? "3000";
  const port = Number(portText);
  if (
    !/^\d+$/.test(portText) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  const timezone = validateTimezone(env.TARE_TIMEZONE ?? "UTC");
  const publicUrl = env.TARE_PUBLIC_URL?.trim() || undefined;
  if (publicUrl !== undefined) {
    try {
      if (!["http:", "https:"].includes(new URL(publicUrl).protocol))
        throw new Error("Unsupported protocol");
    } catch {
      throw new Error("TARE_PUBLIC_URL must be an HTTP or HTTPS URL");
    }
  }
  const sessionDaysText = env.TARE_SESSION_DAYS?.trim() || "30";
  const sessionDays = Number(sessionDaysText);
  if (!/^\d+$/.test(sessionDaysText) || sessionDays < 1 || sessionDays > 365)
    throw new Error("TARE_SESSION_DAYS must be an integer between 1 and 365");
  const backupDirText = env.TARE_BACKUP_DIR?.trim();
  const backupDir = backupDirText ? resolve(backupDirText) : undefined;
  if (backupDir !== undefined && databaseUrl !== ":memory:") {
    const fromDatabase = relative(dirname(resolve(databaseUrl)), backupDir);
    if (
      fromDatabase === "" ||
      (!isAbsolute(fromDatabase) && fromDatabase.split(sep)[0] !== "..")
    )
      throw new Error("TARE_BACKUP_DIR must be outside the database folder");
  }
  const backupKeepText = env.TARE_BACKUP_KEEP?.trim() || "7";
  const backupKeep = Number(backupKeepText);
  if (!/^\d+$/.test(backupKeepText) || backupKeep < 1 || backupKeep > 365)
    throw new Error("TARE_BACKUP_KEEP must be an integer between 1 and 365");
  const username = env.TARE_ADMIN_USERNAME?.trim();
  const password = env.TARE_ADMIN_PASSWORD;
  const teamDomain = env.TARE_ACCESS_TEAM_DOMAIN?.trim() || undefined;
  const audience = env.TARE_ACCESS_AUD?.trim() || undefined;
  if (teamDomain !== undefined) {
    try {
      const url = new URL(teamDomain);
      if (url.protocol !== "https:" || url.origin !== teamDomain)
        throw new Error("HTTPS origin required");
    } catch {
      throw new Error(
        "TARE_ACCESS_TEAM_DOMAIN must be an https origin with no path",
      );
    }
    if (audience === undefined)
      throw new Error(
        "TARE_ACCESS_AUD must be set when TARE_ACCESS_TEAM_DOMAIN is set",
      );
  } else if (audience !== undefined)
    throw new Error(
      "TARE_ACCESS_TEAM_DOMAIN must be set when TARE_ACCESS_AUD is set",
    );
  const accessEmail = normalizeAccessEmail(env.TARE_ADMIN_ACCESS_EMAIL ?? "");
  return {
    databaseUrl,
    port,
    timezone,
    publicUrl,
    sessionDays,
    backupDir,
    backupKeep,
    usdaApiKey: env.TARE_USDA_API_KEY?.trim() || undefined,
    offUserAgent: validateOffUserAgent(env.TARE_OFF_USER_AGENT),
    identity:
      teamDomain !== undefined && audience !== undefined
        ? { mode: "access", teamDomain, audience }
        : { mode: "fallback" },
    firstUser: {
      username: username === "" ? undefined : username,
      password: password === "" ? undefined : password,
      accessEmail: accessEmail ?? undefined,
    },
  };
}
