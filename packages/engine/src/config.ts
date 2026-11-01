export interface Config {
  databaseUrl: string;
  port: number;
  timezone: string;
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
  return { databaseUrl, port, timezone };
}
