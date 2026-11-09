import assert from "node:assert/strict";
import {
  ageYears,
  type FormulaInput,
  formulaTarget,
} from "../src/target/formula.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const formula: FormulaInput = {
  trendKg: 80,
  heightCm: 180,
  ageYears: 40,
  sex: "male",
  activityLevel: "moderate",
  goalRateKgWeek: -0.5,
  proteinFactor: 1.6,
};
const profile = {
  height_cm: 180,
  birth_date: "1986-01-01",
  sex: "male",
  activity_level: "moderate",
  goal_rate_kg_week: -0.5,
};
const bonus = {
  status: "no_source",
  kcal: 0,
  capped: false,
  mode: "same-day",
  day: "2026-01-01",
  source: null,
  burn_kcal: null,
  average_kcal: null,
  last_synced_at: null,
};
const adaptive = {
  status: "learning",
  reason: "signed_days",
  signed_days: 0,
  weigh_in_days: 0,
  span_days: null,
};

test("formula constants, rounding and non-decreasing weight and activity targets", () => {
  const activities = [
    "sedentary",
    "light",
    "moderate",
    "active",
    "very_active",
  ] as const;
  const cases: [Partial<FormulaInput>, number, number, number][] = [
    [{}, 1730, 2130, 128],
    [{ activityLevel: "sedentary" }, 1730, 1530, 128],
    [{ activityLevel: "light" }, 1730, 1830, 128],
    [{ activityLevel: "active" }, 1730, 2430, 128],
    [{ activityLevel: "very_active" }, 1730, 2740, 128],
    [{ sex: "female" }, 1564, 1870, 128],
    [{ trendKg: 80.4 }, 1734, 2140, 129],
  ];
  for (const [changes, resting_kcal, kcal, protein_g] of cases)
    assert.deepEqual(formulaTarget({ ...formula, ...changes }), {
      resting_kcal,
      kcal,
      protein_g,
    });
  for (const changes of [
    [60, 70, 80, 90, 100].map((trendKg) => ({ trendKg })),
    activities.map((activityLevel) => ({ activityLevel })),
  ]) {
    const targets = changes.map(
      (change) => formulaTarget({ ...formula, ...change }).kcal,
    );
    assert.deepEqual(
      targets,
      targets.toSorted((left, right) => left - right),
    );
  }
  for (const [birth, today, expected] of [
    ["1986-01-02", "2026-01-01", 39],
    ["1986-01-02", "2026-01-02", 40],
    ["1984-02-29", "2025-02-28", 40],
    ["1984-02-29", "2025-03-01", 41],
  ] as const)
    assert.equal(ageYears(birth, today), expected);
});

for (const mode of ["fallback", "access"] as const)
  test(`${mode}: profiles, target readiness, remaining and owner isolation`, async (context) => {
    const { admin, member } = await twoUsers(context, mode);
    const send = async (
      person: typeof admin,
      path: string,
      body?: unknown,
      status = 200,
    ) => {
      const response = await person.request(
        path,
        body === undefined
          ? {}
          : {
              method: "POST",
              body: JSON.stringify(body),
            },
      );
      assert.equal(response.status, status);
      return response.json();
    };
    const create = (person: typeof admin, path: string, body: unknown) =>
      send(person, path, body, 201);
    const today = (person = admin) => send(person, "/api/today");
    assert.deepEqual(await send(admin, "/api/profile"), { profile: null });
    assert.deepEqual((await today()).target, {
      status: "needs_profile",
      adaptive,
    });
    const { profile: saved } = await send(admin, "/api/profile", profile);
    assert.deepEqual(saved, {
      ...profile,
      protein_factor: 1.6,
      user_id: admin.user.id,
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    assert.deepEqual(await send(admin, "/api/profile"), { profile: saved });
    assert.deepEqual((await today()).target, {
      status: "needs_weigh_in",
      adaptive,
    });
    assert.deepEqual((await today()).remaining, {
      kcal: null,
      protein_g: null,
    });
    assert.deepEqual(await send(member, "/api/profile"), { profile: null });
    for (const invalid of [
      {},
      { ...profile, birth_date: "2001-02-29" },
      { ...profile, birth_date: "2008-01-02" },
      { ...profile, birth_date: "2030-01-01" },
      { ...profile, height_cm: 99 },
      { ...profile, protein_factor: null },
      { ...profile, user_id: admin.user.id },
    ])
      await send(member, "/api/profile", invalid, 400);
    const { profile: other } = await send(member, "/api/profile", {
      ...profile,
      height_cm: 170,
      protein_factor: 2,
    });
    assert.equal(other.user_id, member.user.id);
    assert.deepEqual(await send(admin, "/api/profile"), { profile: saved });
    assert.deepEqual((await today(member)).target, {
      status: "needs_weigh_in",
      adaptive,
    });
    await create(admin, "/api/weights", {
      client_id: "example-weight",
      weight_kg: 80,
    });
    const expected = {
      status: "ready",
      basis: "live_formula",
      adaptive,
      kcal: 2130,
      base_kcal: 2130,
      bonus,
      protein_g: 128,
      trend_kg: 80,
    };
    assert.deepEqual((await today()).target, expected);
    assert.deepEqual((await today()).remaining, { kcal: 2130, protein_g: 128 });
    await create(admin, "/api/weights", {
      client_id: "example-future",
      measured_at: "2026-01-02T12:00:00.000Z",
      weight_kg: 120,
    });
    assert.deepEqual((await today()).target, expected);
    await create(admin, "/api/intake", {
      client_id: "example-food",
      name: "Example meal",
      kcal: 2300,
      protein_g: 30,
    });
    assert.deepEqual((await today()).remaining, { kcal: -170, protein_g: 98 });
    await create(admin, "/api/intake", {
      client_id: "example-unknown",
      name: "Example protein",
      protein_g: 10,
    });
    const incomplete = await today();
    assert.equal(incomplete.totals.kcal.complete, false);
    assert.deepEqual(incomplete.remaining, { kcal: null, protein_g: 88 });
    await create(member, "/api/weights", {
      client_id: "example-weight",
      weight_kg: 80,
    });
    assert.deepEqual((await today(member)).target, {
      status: "ready",
      basis: "live_formula",
      adaptive,
      kcal: 2030,
      base_kcal: 2030,
      bonus,
      protein_g: 160,
      trend_kg: 80,
    });
    await send(member, "/api/profile", profile);
    assert.deepEqual((await today(member)).target, {
      ...expected,
      basis: "weekly_formula",
    });
    assert.deepEqual((await today(member)).remaining, {
      kcal: 2130,
      protein_g: 128,
    });
    assert.deepEqual(await send(admin, "/api/profile"), { profile: saved });
  });
