import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { accessConfig } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { orderMeal } from "./support/order-meals.ts";
import { grocy, json, pantryHarness } from "./support/pantry-fake.ts";
import { planDay } from "./support/plan-day.ts";
import { twoUsers } from "./support/two-users.ts";

test("a missing pantry service blocks only the owner's food planning", async (context) => {
  const config = {
    ...loadConfig({ DATABASE_URL: ":memory:" }),
    ...accessConfig,
  };
  const { admin, member, database } = await twoUsers(context, "access", {
    config,
  });
  const adminSoup = await planDay(database, admin, "UTC");
  const memberSoup = await planDay(database, member, "UTC");
  // createApp refuses this wiring, so the shared config is changed after startup.
  Object.assign(config, { grocy });
  const owned = await json(admin, "/api/plan/slot", {
    position: 0,
    food_id: adminSoup,
  });
  assert.deepEqual(
    [owned.status, owned.body.error.code],
    [503, "pantry_unavailable"],
  );
  const other = await json(member, "/api/plan/slot", {
    position: 0,
    food_id: memberSoup,
  });
  assert.deepEqual([other.status, "pantry" in other.body], [201, false]);
  const meal = await orderMeal(
    database,
    admin,
    "2026-01-01",
    1,
    "2026-01-01T00:00:00.000Z",
  );
  assert.equal(
    (await json(admin, "/api/plan/slot", { position: 1, meal_id: meal }))
      .status,
    201,
  );
});

test("plan_slot rechecks a bound food against the fetch start without reserving stock", async (context) => {
  const harness = await pantryHarness(context);
  const { admin, member, database, clock } = harness;
  const soup = await planDay(database, admin, "UTC");
  const memberSoup = await planDay(database, member, "UTC");
  harness.bind("food", soup, 7);
  const plan = (body: object) => json(admin, "/api/plan/slot", body);
  let item = (await plan({ position: 0, food_id: soup })).body.item;
  // Same servings is a no-op return, which still reports the current caveat.
  const recheck = async (servings = 1) => {
    const result = await plan({
      position: 0,
      food_id: soup,
      servings,
      item_id: item.id,
      revision: item.revision,
    });
    item = result.body.item;
    return result.body.pantry;
  };
  assert.deepEqual((await recheck()).reasons, ["unknown", "stale"]);
  const other = await json(member, "/api/plan/slot", {
    position: 0,
    food_id: memberSoup,
  });
  assert.deepEqual([other.status, "pantry" in other.body], [201, false]);

  // An old snapshot is stale against the request clock.
  clock.now = () => new Date("2025-12-31T23:00:00.000Z");
  await json(admin, "/api/pantry/refresh", {});
  assert.ok((await recheck()).reasons.includes("stale"));
  const fetchedAt = "2026-01-01T00:00:00.000Z";
  clock.now = () => new Date(fetchedAt);
  await json(admin, "/api/pantry/refresh", {});

  harness.request(soup, "pending", 1);
  const after = harness.request(soup, "sending", 2, "2026-01-01T00:00:01.000Z");
  harness.request(soup, "sending", 4, fetchedAt);
  const delivered = harness.request(soup, "delivered", 8, fetchedAt);
  harness.request(soup, "delivered", 16, "2025-12-31T23:59:59.000Z");
  harness.request(soup, "uncertain", 32);
  const ready = await recheck();
  assert.deepEqual(ready.state_amounts, {
    pending: 1,
    sending_after: 2,
    sending_before_or_equal: 4,
    delivered_after_or_equal: 8,
    uncertain: 32,
    rejected: 0,
  });
  assert.deepEqual(
    [ready.raw, ready.deducted, ready.adjusted, ready.needed, ready.reasons],
    [10, 3, 7, 0.5, ["uncertain"]],
  );
  const short = await recheck(20);
  assert.deepEqual([short.shortfall, short.reasons.at(-1)], [3, "short"]);
  assert.deepEqual((await recheck(20)).shortfall, 3);

  // A bucket with one unclassifiable row is unknown as a whole, never a partial sum.
  database
    .prepare(
      "UPDATE pantry_attempts SET started_at = 'not-a-time' WHERE request_id = ?",
    )
    .run(after);
  const untimed = await recheck();
  assert.deepEqual(
    [
      untimed.state_amounts.sending_after,
      untimed.state_amounts.sending_before_or_equal,
      untimed.deducted,
      untimed.adjusted,
      untimed.raw,
      untimed.needed,
      untimed.reasons,
    ],
    [null, null, null, null, 10, 0.5, ["unknown", "uncertain"]],
  );
  database
    .prepare("UPDATE pantry_attempts SET started_at = ? WHERE request_id = ?")
    .run("2026-01-01T00:00:01.000Z", after);
  database
    .prepare(
      "UPDATE pantry_attempts SET finished_at = NULL WHERE request_id = ?",
    )
    .run(delivered);
  const unconfirmed = await recheck();
  assert.deepEqual(
    [
      unconfirmed.state_amounts.delivered_after_or_equal,
      unconfirmed.deducted,
      unconfirmed.timing_unknown,
    ],
    [null, 3, true],
  );
  assert.equal(
    database.prepare("SELECT count(*) FROM pantry_requests").pluck().get(),
    6,
  );

  // A valid product absent from a successful snapshot has none in stock.
  const oats = Number(
    database
      .prepare(
        "INSERT INTO foods (user_id, name, provenance) VALUES (?, 'Synthetic oats', 'label')",
      )
      .run(admin.user.id).lastInsertRowid,
  );
  harness.bind("food", oats, 8);
  const empty = await plan({ position: 1, food_id: oats });
  const { raw, shortfall, reasons } = empty.body.pantry;
  assert.deepEqual([raw, shortfall, reasons], [0, 0.5, ["short"]]);
  // An unresolved request in an older unit is still unresolved.
  database
    .prepare(
      "UPDATE pantry_requests SET product_id = 8, stock_unit_id = 3, reference_id = ? WHERE id = ?",
    )
    .run(oats, harness.request(soup, "uncertain", 1));
  const { id: oatsItem, revision: oatsRevision } = empty.body.item;
  const resent = await plan({
    position: 1,
    food_id: oats,
    item_id: oatsItem,
    revision: oatsRevision,
  });
  assert.deepEqual(
    [
      resent.body.pantry.state_amounts.uncertain,
      resent.body.pantry.unit_mismatch,
      resent.body.pantry.reasons,
    ],
    [null, true, ["unknown", "uncertain"]],
  );

  // A binding saved after Grocy's unit changed but before the next refresh.
  const rice = Number(
    database
      .prepare(
        "INSERT INTO foods (user_id, name, provenance) VALUES (?, 'Synthetic rice', 'label')",
      )
      .run(admin.user.id).lastInsertRowid,
  );
  harness.bind("food", rice, 10, 3);
  const expected = [2, 5, null, null, true, "valid"];
  const fields = (availability: Record<string, unknown>) =>
    [
      "stock_unit_id",
      "raw",
      "needed",
      "adjusted",
      "unit_mismatch",
      "binding_status",
    ].map((key) => availability[key]);
  const changed = await plan({
    position: 0,
    food_id: rice,
    item_id: item.id,
    revision: item.revision,
  });
  assert.deepEqual(
    [changed.status, ...fields(changed.body.pantry)],
    [200, ...expected],
  );
  item = changed.body.item;
  const noop = await plan({
    position: 0,
    food_id: rice,
    item_id: item.id,
    revision: item.revision,
  });
  assert.deepEqual(
    [noop.status, ...fields(noop.body.pantry)],
    [200, ...expected],
  );

  harness.egress.apiKey = "Synthetic rice";
  const { id, revision } = empty.body.item;
  const withheld = await plan({
    position: 1,
    food_id: rice,
    item_id: id,
    revision,
  });
  assert.deepEqual(
    [withheld.status, withheld.body],
    [503, { error: { code: "pantry_response_withheld" } }],
  );
});
