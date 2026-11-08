import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { writeTransaction } from "../src/db.ts";
import { recomputeTarget } from "../src/target/recompute.ts";
import { cookie } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const settings = loadConfig({ DATABASE_URL: ":memory:" }).tdee;
const now = new Date("2026-01-01T00:00:00.000Z");
const profile = {
  height_cm: 170,
  birth_date: "1990-01-01",
  sex: "female",
  activity_level: "light",
  goal_rate_kg_week: -0.25,
};

test("recompute stores a notice per person until dismissed on any device", async (context) => {
  const setup = await twoUsers(context, "fallback");
  const { database, admin, member } = setup;
  const recompute = (changes: string) => {
    database
      .prepare(`UPDATE profiles SET ${changes} WHERE user_id = ?`)
      .run(admin.user.id);
    writeTransaction(database, (scope) =>
      recomputeTarget(scope, admin.user, now, settings, "weekly"),
    );
  };
  const notice = async (request = admin.request) =>
    (await (await request("/api/today")).json()).target_notice;
  const dismiss = (id: number, request = admin.request) =>
    request("/api/target-notice/dismiss", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
  const secondCookie = cookie(await setup.signIn(admin.credentials));
  const otherDevice = async (path: string, init: RequestInit = {}) =>
    setup.app.request(path, {
      ...init,
      headers: { Cookie: secondCookie, "X-Requested-With": "XMLHttpRequest" },
    });
  for (const actor of [admin, member]) {
    const saved = await actor.request("/api/profile", {
      method: "POST",
      body: JSON.stringify(profile),
    });
    assert.equal(saved.status, 200);
    const weighed = await actor.request("/api/weights", {
      method: "POST",
      body: JSON.stringify({ client_id: "w1", weight_kg: 70 }),
    });
    assert.equal(weighed.status, 201);
  }
  recompute("goal_rate_kg_week = -0.25");
  assert.equal(await notice(), null);

  recompute("goal_rate_kg_week = -0.5");
  const calories = await notice();
  assert.deepEqual(
    [calories.old_kcal - calories.new_kcal, calories.old_protein_g],
    [280, calories.new_protein_g],
  );
  assert.equal((await dismiss(calories.id, member.request)).status, 404);
  assert.equal(await notice(member.request), null);
  assert.deepEqual(await notice(), calories);

  assert.equal((await dismiss(calories.id, otherDevice)).status, 200);
  assert.equal(await notice(), null);
  recompute("goal_rate_kg_week = -0.5");
  assert.equal(await notice(otherDevice), null);

  recompute("protein_factor = 2");
  const protein = await notice(otherDevice);
  assert.notEqual(protein.id, calories.id);
  assert.deepEqual(
    [protein.old_kcal, protein.old_protein_g, protein.new_protein_g],
    [protein.new_kcal, 112, 140],
  );
});
