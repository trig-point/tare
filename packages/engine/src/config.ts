import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { z as zod } from "zod";
import { normalizeAccessEmail } from "./auth/access.ts";
import {
  type GrocyConfig,
  parseGrocyConfig,
  safeGrocyText,
} from "./grocy/config.ts";

export interface TdeeSettings {
  windowDays: number;
  energyDensity: number;
  minSignedDays: number;
  minWeighInDays: number;
  minSpanDays: number;
  defaultRange: number;
}

export interface WhySettings {
  baselineDays: number;
  minBaselineDays: number;
  deviations: number;
  hrvPercent: number;
  lateHours: number;
  lateMinutes: number;
}

export interface Config {
  grocy: GrocyConfig | null;
  orderEmailServices: Record<
    string,
    { senders: string[]; dkim_domains: string[] }
  >;
  tdee: TdeeSettings;
  why: WhySettings;
  databaseUrl: string;
  port: number;
  timezone: string;
  targetWeekday: number;
  activityCredit: "same-day" | "next-day";
  activityBonusCap: number;
  publicUrl: string | undefined;
  mcpAllowedOrigins: string[];
  sessionDays: number;
  backupDir: string | undefined;
  backupKeep: number;
  usdaApiKey: string | undefined;
  offUserAgent: string | undefined;
  orderModel: { baseURL: string; model: string; apiKey: string } | null;
  oura: { clientId: string; clientSecret: string; redirectUrl: string } | null;
  ouraTokenKey: Buffer | undefined;
  mqtt: MqttConfig | null;
  scale: ScaleConfig | null;
  identity:
    | { mode: "access"; teamDomain: string; audience: string }
    | { mode: "fallback" };
  firstUser: {
    username: string | undefined;
    password: string | undefined;
    accessEmail?: string;
  };
}

export interface MqttConfig {
  url: string;
  username: string | undefined;
  password: string | undefined;
  discoveryPrefix: string;
  statusTopic: string;
}

export interface ScaleConfig {
  topic: string;
  users: Record<string, string>;
}

export function domainMatches(signingDomain: string, domain: string): boolean {
  return signingDomain === domain || signingDomain.endsWith(`.${domain}`);
}

function parseOrderEmailServices(
  value: string | undefined,
): Config["orderEmailServices"] {
  if (!value?.trim()) return {};
  try {
    const services = zod
      .record(
        zod.string().regex(/^[a-z0-9-]{1,40}$/),
        zod
          .strictObject({
            senders: zod.array(
              zod.email().transform((address) => address.toLowerCase()),
            ),
            dkim_domains: zod.array(
              zod.hostname().transform((domain) => domain.toLowerCase()),
            ),
          })
          .refine(
            (service) =>
              service.senders.length + service.dkim_domains.length > 0,
          ),
      )
      .parse(JSON.parse(value));
    const senders = new Set<string>();
    const domains: { domain: string; service: string }[] = [];
    for (const [name, service] of Object.entries(services)) {
      for (const sender of service.senders) {
        if (senders.has(sender)) throw new Error("Duplicate sender");
        senders.add(sender);
      }
      for (const domain of service.dkim_domains) {
        if (
          domains.some(
            (other) =>
              other.service !== name &&
              (domainMatches(domain, other.domain) ||
                domainMatches(other.domain, domain)),
          )
        )
          throw new Error("Overlapping domains");
        domains.push({ domain, service: name });
      }
    }
    return services;
  } catch {
    throw new Error(
      "TARE_ORDER_EMAIL_SERVICES must contain valid, non-overlapping services",
    );
  }
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

function parseOrderModel(
  env: Record<string, string | undefined>,
): Config["orderModel"] {
  const settings = [
    "TARE_ORDER_MODEL_BASE_URL",
    "TARE_ORDER_MODEL",
    "TARE_ORDER_MODEL_API_KEY",
  ] as const;
  const values = settings.map((setting) => env[setting]?.trim());
  if (!values.some(Boolean)) return null;
  for (const [index, setting] of settings.entries()) {
    if (!values[index])
      throw new Error(
        `${setting} must be set when an order model is configured`,
      );
  }
  const [baseURL, model, apiKey] = values as [string, string, string];
  try {
    const url = new URL(baseURL);
    // The SDK appends paths to the base URL, and fetch rejects embedded credentials.
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Unsupported URL");
  } catch {
    throw new Error("TARE_ORDER_MODEL_BASE_URL must be an HTTP or HTTPS URL");
  }
  return { baseURL, model, apiKey };
}

function parseOura(env: Record<string, string | undefined>): Config["oura"] {
  const settings = [
    "TARE_OURA_CLIENT_ID",
    "TARE_OURA_CLIENT_SECRET",
    "TARE_OURA_REDIRECT_URL",
  ] as const;
  const values = settings.map((setting) => env[setting]?.trim());
  if (!values.some(Boolean)) return null;
  for (const [index, setting] of settings.entries()) {
    if (!values[index])
      throw new Error(`${setting} must be set when Oura is configured`);
  }
  const [clientId, clientSecret, redirectUrl] = values as [
    string,
    string,
    string,
  ];
  try {
    const url = new URL(redirectUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.hash ||
      redirectUrl.includes("#")
    )
      throw new Error();
  } catch {
    throw new Error(
      "TARE_OURA_REDIRECT_URL must be an absolute HTTP or HTTPS URL without a fragment",
    );
  }
  return { clientId, clientSecret, redirectUrl };
}

function parseOuraKey(value: string | undefined): Buffer | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const key = Buffer.from(text, "base64");
  if (key.length !== 32 || key.toString("base64") !== text)
    throw new Error(
      "TARE_OURA_TOKEN_KEY must be canonical base64 for 32 bytes",
    );
  return key;
}

function parseTopic(
  env: Record<string, string | undefined>,
  name: string,
  fallback: string,
) {
  const topic = env[name]?.trim() || fallback;
  if (/[+#\s]/.test(topic) || topic.split("/").some((level) => level === ""))
    throw new Error(`${name} must be an MQTT topic without wildcards`);
  return topic;
}

function parseMqtt(env: Record<string, string | undefined>): Config["mqtt"] {
  const discoveryPrefix = parseTopic(
    env,
    "TARE_HA_DISCOVERY_PREFIX",
    "homeassistant",
  );
  const statusTopic = parseTopic(
    env,
    "TARE_HA_STATUS_TOPIC",
    "homeassistant/status",
  );
  const username = env.TARE_MQTT_USERNAME?.trim() || undefined;
  const password = env.TARE_MQTT_PASSWORD?.trim() || undefined;
  if ((username === undefined) !== (password === undefined))
    throw new Error(
      `${username === undefined ? "TARE_MQTT_USERNAME" : "TARE_MQTT_PASSWORD"} must be set when the other MQTT credential is set`,
    );
  const url = env.TARE_MQTT_URL?.trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (
      !["mqtt:", "mqtts:"].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      !["", "/"].includes(parsed.pathname) ||
      parsed.search ||
      parsed.hash
    )
      throw new Error("Unsupported URL");
  } catch {
    throw new Error(
      "TARE_MQTT_URL must be an mqtt or mqtts URL without credentials or a path",
    );
  }
  return { url, username, password, discoveryPrefix, statusTopic };
}

function parseScale(
  env: Record<string, string | undefined>,
  mqtt: Config["mqtt"],
): Config["scale"] {
  const text = env.TARE_SCALE_USERS?.trim();
  if (!text) return null;
  let users: Record<string, string>;
  try {
    users = zod
      .record(
        zod
          .string()
          .regex(/^[^\s/+#]+$/)
          .refine((slug) => slug !== "status"),
        zod.string().trim().min(1),
      )
      .refine((map) => {
        const names = Object.values(map);
        return new Set(names).size === names.length;
      })
      .parse(JSON.parse(text));
  } catch {
    throw new Error(
      "TARE_SCALE_USERS must map single-level scale users to distinct usernames",
    );
  }
  if (Object.keys(users).length === 0) return null;
  if (!mqtt) throw new Error("TARE_SCALE_USERS requires TARE_MQTT_URL");
  return {
    topic: parseTopic(env, "TARE_SCALE_TOPIC", "scale/body-composition"),
    users,
  };
}

export function parsePort(value: string | undefined): number {
  const portText = value ?? "3000";
  const port = Number(portText);
  if (
    !/^\d+$/.test(portText) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

function parseMcpAllowedOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.split(",").map((entry) => {
    const origin = entry.trim();
    try {
      const url = new URL(origin);
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin)
        throw new Error("HTTP or HTTPS origin required");
    } catch {
      throw new Error(
        `TARE_MCP_ALLOWED_ORIGINS has an invalid origin: ${origin}`,
      );
    }
    return origin;
  });
}

function settingReader(env: Record<string, string | undefined>) {
  return (
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
    integer = false,
  ) => {
    const text = env[name]?.trim();
    const pattern = integer ? /^\d+$/ : /^\d+(\.\d+)?$/;
    const value = !text
      ? fallback
      : pattern.test(text)
        ? Number(text)
        : Number.NaN;
    if (
      !Number.isFinite(value) ||
      value < minimum ||
      value > maximum ||
      (integer && !Number.isInteger(value))
    )
      throw new Error(
        `${name} must be ${integer ? "an integer" : "a number"} between ${minimum} and ${maximum}`,
      );
    return value;
  };
}

function parseWhySettings(
  env: Record<string, string | undefined>,
): WhySettings {
  const number = settingReader(env);
  const baselineDays = number("TARE_WHY_BASELINE_DAYS", 28, 14, 90, true);
  return {
    baselineDays,
    minBaselineDays: number(
      "TARE_WHY_MIN_BASELINE_DAYS",
      14,
      2,
      baselineDays,
      true,
    ),
    deviations: number("TARE_WHY_DEVIATIONS", 1, 0.1, 5),
    hrvPercent: number("TARE_WHY_HRV_PERCENT", 10, 0, 100),
    lateHours: number("TARE_WHY_LATE_HOURS", 4, 1, 12, true),
    lateMinutes: number("TARE_WHY_LATE_MINUTES", 30, 1, 240, true),
  };
}

function parseTdeeSettings(
  env: Record<string, string | undefined>,
): TdeeSettings {
  const number = settingReader(env);
  const windowDays = number("TARE_TDEE_WINDOW_DAYS", 28, 14, 90, true);
  return {
    windowDays,
    energyDensity: number("TARE_TDEE_ENERGY_DENSITY", 7700, 5000, 10000),
    minSignedDays: number("TARE_TDEE_MIN_SIGNED_DAYS", 14, 1, windowDays, true),
    minWeighInDays: number(
      "TARE_TDEE_MIN_WEIGH_IN_DAYS",
      8,
      1,
      windowDays,
      true,
    ),
    minSpanDays: number("TARE_TDEE_MIN_SPAN_DAYS", 14, 1, windowDays, true),
    defaultRange: number("TARE_TDEE_DEFAULT_RANGE", 0.25, 0, 0.9),
  };
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const port = parsePort(env.PORT);
  const timezone = validateTimezone(env.TARE_TIMEZONE ?? "UTC");
  const targetWeekday = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ].indexOf(env.TARE_TARGET_WEEKDAY?.trim().toLowerCase() || "monday");
  if (targetWeekday === -1)
    throw new Error("TARE_TARGET_WEEKDAY must be an English weekday name");
  const activityCredit =
    env.TARE_ACTIVITY_CREDIT?.trim().toLowerCase() || "same-day";
  if (activityCredit !== "same-day" && activityCredit !== "next-day")
    throw new Error("TARE_ACTIVITY_CREDIT must be same-day or next-day");
  const bonusCapText = env.TARE_ACTIVITY_BONUS_CAP?.trim() || "500";
  const activityBonusCap = Number(bonusCapText);
  if (
    !/^\d+$/.test(bonusCapText) ||
    activityBonusCap < 1 ||
    activityBonusCap > 2000
  )
    throw new Error(
      "TARE_ACTIVITY_BONUS_CAP must be an integer between 1 and 2000",
    );
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
  const mqtt = parseMqtt(env);
  return {
    grocy: parseGrocyConfig(env),
    orderEmailServices: parseOrderEmailServices(env.TARE_ORDER_EMAIL_SERVICES),
    tdee: parseTdeeSettings(env),
    why: parseWhySettings(env),
    databaseUrl,
    port,
    timezone,
    targetWeekday,
    activityCredit,
    activityBonusCap,
    publicUrl,
    mcpAllowedOrigins: parseMcpAllowedOrigins(env.TARE_MCP_ALLOWED_ORIGINS),
    sessionDays,
    backupDir,
    backupKeep,
    usdaApiKey: env.TARE_USDA_API_KEY?.trim() || undefined,
    offUserAgent: validateOffUserAgent(env.TARE_OFF_USER_AGENT),
    orderModel: parseOrderModel(env),
    oura: parseOura(env),
    ouraTokenKey: parseOuraKey(env.TARE_OURA_TOKEN_KEY),
    mqtt,
    scale: parseScale(env, mqtt),
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

export function loadStartupConfig(
  env: Record<string, string | undefined>,
  report: (message: string) => void = console.error,
) {
  try {
    return loadConfig(env);
  } catch (error) {
    reportStartupError(error, env.TARE_GROCY_API_KEY, report);
    return undefined;
  }
}

export function reportStartupError(
  error: unknown,
  key: string | undefined,
  report: (message: string) => void = console.error,
) {
  const message = safeGrocyText(
    error instanceof Error ? error.message : "First administrator setup failed",
    key?.trim(),
  );
  if (message !== undefined) report(message);
}
