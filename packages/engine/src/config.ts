export interface Config {
  databaseUrl: string;
  port: number;
  timezone: string;
  publicUrl: string | undefined;
  sessionDays: number;
  offUserAgent: string | undefined;
  firstUser: { username: string | undefined; password: string | undefined };
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
  const username = env.TARE_ADMIN_USERNAME?.trim();
  const password = env.TARE_ADMIN_PASSWORD;
  return {
    databaseUrl,
    port,
    timezone,
    publicUrl,
    sessionDays,
    offUserAgent: validateOffUserAgent(env.TARE_OFF_USER_AGENT),
    firstUser: {
      username: username === "" ? undefined : username,
      password: password === "" ? undefined : password,
    },
  };
}
