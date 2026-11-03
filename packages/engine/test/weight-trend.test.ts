import assert from "node:assert/strict";
import { insertWeight } from "../src/queries/insert-weight.ts";
import { type WeightReading, weightTrend } from "../src/trend/weight-trend.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const reading = (day: string, weight_kg: number): WeightReading => ({
  day,
  weight_kg,
});
const base = [
  reading("2026-02-28", 80),
  reading("2026-03-01", 81),
  reading("2026-03-07", 79.6),
] as const;
const expected = [
  ["2026-02-28", 80, 80],
  ["2026-03-01", 81, 80.1],
  ["2026-03-02", null, 80.1],
  ["2026-03-03", null, 80.1],
  ["2026-03-04", null, 80.1],
  ["2026-03-05", null, 80.1],
  ["2026-03-06", null, 80.1],
  ["2026-03-07", 79.6, 80.05],
];

test("trend starts at the first reading, holds gaps and recomputes past changes", () => {
  const cases: [readonly WeightReading[], number | undefined][] = [
    [[], undefined],
    [[base[0]], 80],
    [base, 80.05],
    [[base[0], reading("2026-02-28", 200), ...base.slice(1)], 80.05],
    [[...base.slice(0, 2), reading("2026-03-02", 82), base[2]], 80.221],
    [[base[0], reading("2026-03-01", 82), base[2]], 80.14],
    [[base[0], base[2]], 79.96],
  ];
  for (const [rows, last] of cases) {
    const actual = weightTrend(rows);
    if (last === undefined) assert.deepEqual(actual, []);
    else {
      const finalDay = actual.at(-1);
      assert.ok(finalDay);
      assert.ok(Math.abs(finalDay.trend_kg - last) < 1e-10);
    }
  }
  assert.deepEqual(
    weightTrend(base).map((day) => [day.day, day.reading_kg, day.trend_kg]),
    expected,
  );
});

test("weight history uses stored days, the earliest reading and only its owner", async (context) => {
  const setup = await twoUsers(context, "fallback");
  const history = async (person: typeof setup.admin) => {
    const response = await person.request("/api/weights/history");
    assert.equal(response.status, 200);
    return (await response.json()).days;
  };
  assert.deepEqual(await history(setup.admin), []);
  for (const [index, row] of [
    { ...reading("2026-03-01", 200), measured_at: "2026-03-01T20:00:00.000Z" },
    { ...base[0], measured_at: "2026-03-01T00:00:00.000Z" },
    { ...base[1], measured_at: "2026-03-01T01:00:00.000Z" },
    { ...base[2], measured_at: "2026-03-07T01:00:00.000Z" },
    { ...reading("2026-03-01", 90), measured_at: "2026-03-01T01:00:00.000Z" },
  ].entries()) {
    assert.ok(
      insertWeight(setup.database, {
        ...row,
        user_id: index === 4 ? setup.member.user.id : setup.admin.user.id,
        client_id: `invented-weight-${index}`,
        body_fat_pct: null,
        source: null,
        created_at: row.measured_at,
      }),
    );
  }
  assert.deepEqual(
    await history(setup.admin),
    expected.map(([day, reading_kg, trend_kg]) => ({
      day,
      reading_kg,
      trend_kg,
    })),
  );
  assert.deepEqual(await history(setup.member), [
    { day: "2026-03-01", reading_kg: 90, trend_kg: 90 },
  ]);
});
