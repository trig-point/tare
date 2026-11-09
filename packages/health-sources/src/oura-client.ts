import type { z as zod } from "zod";
import {
  dailyActivity,
  dailyReadiness,
  dailySleep,
  dailyStress,
  page,
  sleepPeriod,
  workout,
} from "./oura-schema.ts";

export const ouraEndpoints = {
  daily_activity: dailyActivity,
  sleep: sleepPeriod,
  daily_readiness: dailyReadiness,
  daily_sleep: dailySleep,
  daily_stress: dailyStress,
  workout,
} as const;
export type Endpoint = keyof typeof ouraEndpoints;
export type OuraData = {
  [Name in Endpoint]: zod.infer<(typeof ouraEndpoints)[Name]>[];
};
export type OuraFailure =
  | "oura_rate_limited"
  | "oura_membership_required"
  | "oura_unauthorized"
  | "oura_unavailable"
  | "oura_invalid_response";
export interface OuraFetchOptions {
  accessToken: string;
  /** Inclusive first day and exclusive last day, as YYYY-MM-DD. */
  startDate: string;
  endDate: string;
  /** Earlier first days for some endpoints, for a one-off backfill. */
  startDates?: Partial<Record<Endpoint, string>>;
  signal: AbortSignal;
  fetch?: typeof fetch;
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
  baseUrl?: string;
}

const retryDelays = [1_000, 2_000, 4_000, 8_000];
const maxPages = 50;

class Failure extends Error {
  readonly code: OuraFailure;
  constructor(code: OuraFailure) {
    super(code);
    this.code = code;
  }
}

export function fetchOura(
  options: OuraFetchOptions,
): Promise<OuraData | OuraFailure> {
  return failureCode(options, async () => {
    const data: Partial<Record<Endpoint, unknown[]>> = {};
    for (const name of Object.keys(ouraEndpoints) as Endpoint[])
      data[name] = await fetchCollection(options, name);
    return data as OuraData;
  });
}

export function fetchOuraCollection<Name extends Endpoint>(
  options: OuraFetchOptions,
  name: Name,
): Promise<OuraData[Name] | OuraFailure> {
  return failureCode(
    options,
    async () => (await fetchCollection(options, name)) as OuraData[Name],
  );
}

async function failureCode<Result>(
  options: OuraFetchOptions,
  read: () => Promise<Result>,
): Promise<Result | OuraFailure> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof Failure) return error.code;
    if (options.signal.aborted) throw error;
    return "oura_unavailable";
  }
}

async function fetchCollection(options: OuraFetchOptions, name: Endpoint) {
  const items: unknown[] = [];
  let nextToken: string | null | undefined;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
    const url = new URL(
      `v2/usercollection/${name}`,
      options.baseUrl ?? "https://api.ouraring.com/",
    );
    url.searchParams.set(
      "start_date",
      options.startDates?.[name] ?? options.startDate,
    );
    url.searchParams.set("end_date", options.endDate);
    if (nextToken) url.searchParams.set("next_token", nextToken);
    const body = page(ouraEndpoints[name]).safeParse(
      await request(options, url),
    );
    if (!body.success) throw new Failure("oura_invalid_response");
    items.push(...body.data.data);
    nextToken = body.data.next_token;
    if (!nextToken) return items;
  }
  throw new Failure("oura_invalid_response");
}

async function request(options: OuraFetchOptions, url: URL) {
  for (let attempt = 0; ; attempt++) {
    const response = await (options.fetch ?? fetch)(url, {
      headers: { Authorization: `Bearer ${options.accessToken}` },
      signal: options.signal,
    });
    if (response.ok) {
      try {
        return await response.json();
      } catch {
        throw new Failure("oura_invalid_response");
      }
    }
    await response.body?.cancel();
    if (response.status === 401) throw new Failure("oura_unauthorized");
    if (response.status === 403) throw new Failure("oura_membership_required");
    if (response.status !== 429) throw new Failure("oura_unavailable");
    const delay = retryDelays[attempt];
    if (delay === undefined) throw new Failure("oura_rate_limited");
    const retryAfter = Number(response.headers.get("retry-after"));
    await options.wait(
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 60_000)
        : delay,
      options.signal,
    );
  }
}
