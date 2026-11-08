import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchOura, mapOura, type OuraData } from "../src/index.ts";

const night = (
  id: string,
  day: string,
  start: string,
  end: string,
  seconds: number,
  heart = 52,
  hrv = 40,
) => ({
  id,
  day,
  type: id.includes("nap") ? "late_nap" : "long_sleep",
  bedtime_start: start,
  bedtime_end: end,
  total_sleep_duration: seconds,
  lowest_heart_rate: heart,
  average_hrv: hrv,
});
const sample: OuraData = {
  daily_activity: [{ day: "2026-01-02", steps: 8123, active_calories: 412 }],
  sleep: [
    night(
      "sleep-main",
      "2026-01-02",
      "2026-01-01T23:10:00.000+01:00",
      "2026-01-02T07:00:00.000+01:00",
      25_200,
    ),
    night(
      "sleep-nap",
      "2026-01-02",
      "2026-01-02T15:00:00.000+01:00",
      "2026-01-02T15:40:00.000+01:00",
      1_800,
      60,
      30,
    ),
    {
      ...night(
        "sleep-gone",
        "2026-01-02",
        "2026-01-02T16:00:00.000+01:00",
        "2026-01-02T16:30:00.000+01:00",
        900,
      ),
      type: "deleted",
    },
  ],
  daily_readiness: [
    { day: "2026-01-02", score: 81 },
    { day: "2026-01-03", score: null },
  ],
  workout: [
    {
      id: "workout-run",
      day: "2026-01-02",
      activity: "running",
      calories: 310.5,
      start_datetime: "2026-01-02T08:00:00.000+01:00",
      end_datetime: "2026-01-02T08:45:00.000+01:00",
    },
    {
      id: "workout-walk",
      day: "2026-01-02",
      activity: "walking",
      calories: null,
      start_datetime: "2026-01-02T18:00:00.000+01:00",
      end_datetime: "2026-01-02T18:20:00.000+01:00",
    },
  ],
};

test("maps each endpoint into the signals vocabulary and keeps every period and session", () => {
  const mapped = mapOura(sample);
  assert.deepEqual(mapped.daily, [
    { day: "2026-01-02", metric: "steps", value: 8123 },
    { day: "2026-01-02", metric: "active_calories", value: 412 },
    { day: "2026-01-02", metric: "readiness", value: 81 },
    { day: "2026-01-02", metric: "sleep", value: 450 },
    { day: "2026-01-02", metric: "resting_heart_rate", value: 52 },
    { day: "2026-01-02", metric: "hrv", value: 40 },
  ]);
  assert.deepEqual(
    mapped.sleepPeriods.map((period) => [
      period.recordId,
      period.startedAt,
      period.sleepMinutes,
    ]),
    [
      ["sleep-main", "2026-01-01T22:10:00.000Z", 420],
      ["sleep-nap", "2026-01-02T14:00:00.000Z", 30],
    ],
  );
  assert.deepEqual(
    mapped.sessions.map((session) => [
      session.recordId,
      session.durationMinutes,
      session.calories,
    ]),
    [
      ["workout-run", 45, 310.5],
      ["workout-walk", 20, null],
    ],
  );
});

function stub(responses: Record<string, Response[]>) {
  const requests: URL[] = [];
  const waits: number[] = [];
  const options = {
    accessToken: "invented-access",
    startDate: "2026-01-01",
    endDate: "2026-01-08",
    signal: new AbortController().signal,
    wait: async (milliseconds: number) => void waits.push(milliseconds),
    fetch: (async (input: URL) => {
      requests.push(input);
      const name = input.pathname.split("/").at(-1) as string;
      return (
        responses[name]?.shift() ??
        Response.json({ data: [], next_token: null })
      );
    }) as typeof fetch,
  };
  return { options, requests, waits };
}

test("fetches the whole window in one call per endpoint and follows next_token", async () => {
  const { options, requests } = stub({
    workout: [
      Response.json({ data: [sample.workout[0]], next_token: "invented-next" }),
      Response.json({ data: [sample.workout[1]] }),
    ],
  });
  const data = await fetchOura(options);
  assert.ok(typeof data !== "string");
  assert.equal(data.workout.length, 2);
  assert.deepEqual(
    requests.map(
      (url) => `${url.pathname.split("/").at(-1)} ${url.searchParams}`,
    ),
    [
      "daily_activity start_date=2026-01-01&end_date=2026-01-08",
      "sleep start_date=2026-01-01&end_date=2026-01-08",
      "daily_readiness start_date=2026-01-01&end_date=2026-01-08",
      "workout start_date=2026-01-01&end_date=2026-01-08",
      "workout start_date=2026-01-01&end_date=2026-01-08&next_token=invented-next",
    ],
  );
});

test("backs off on 429, honours Retry-After and gives up as rate limited", async () => {
  const limited = (headers?: HeadersInit) =>
    new Response(null, { status: 429, headers });
  const recovered = stub({
    daily_activity: [
      limited({ "Retry-After": "7" }),
      limited(),
      Response.json({ data: [] }),
    ],
  });
  assert.equal(typeof (await fetchOura(recovered.options)), "object");
  assert.deepEqual(recovered.waits, [7_000, 2_000]);
  const exhausted = stub({ sleep: Array.from({ length: 5 }, () => limited()) });
  assert.equal(await fetchOura(exhausted.options), "oura_rate_limited");
  assert.deepEqual(exhausted.waits, [1_000, 2_000, 4_000, 8_000]);
});

test("classifies membership, authorization and malformed responses", async () => {
  for (const [response, expected] of [
    [new Response(null, { status: 403 }), "oura_membership_required"],
    [new Response(null, { status: 401 }), "oura_unauthorized"],
    [new Response(null, { status: 500 }), "oura_unavailable"],
    [Response.json({ data: [{ day: "not-a-day" }] }), "oura_invalid_response"],
    [new Response("not json"), "oura_invalid_response"],
  ] as const)
    assert.equal(
      await fetchOura(stub({ sleep: [response] }).options),
      expected,
    );
});
