import assert from "node:assert/strict";
import { writeTransaction } from "../src/db.ts";
import { createJobRunner } from "../src/jobs.ts";
import { mealNutritionKinds } from "../src/meal-nutrition/index.ts";
import { createOrder, isDue, updateMeal } from "../src/orders/index.ts";
import { createOrderMaintenanceJob } from "../src/orders/maintenance.ts";
import { selectOrder } from "../src/queries/orders/select-order.ts";
import { selectOrderMeal } from "../src/queries/orders/select-order-meal.ts";
import type { UpdateOrderMealResult } from "../src/queries/orders/update-order-meal.ts";
import { assertionHeader, signAccessToken } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

for (const mode of ["fallback", "access"] as const) {
  test(`${mode}: meals follow the person's day, delivery, revisions and ownership`, async (context) => {
    const { app, database, admin, member, setNow } = await twoUsers(
      context,
      mode,
    );
    if (mode === "access") {
      for (const person of [admin, member]) {
        const headers = assertionHeader(
          await signAccessToken({
            email: person.credentials.email,
            exp: new Date("2026-01-03T00:00:00Z").getTime() / 1000,
          }),
        );
        person.request = async (path, init = {}) =>
          app.request(path, {
            ...init,
            headers: { ...headers, "X-Requested-With": "XMLHttpRequest" },
          });
      }
    }
    let now = "2026-01-01T22:29:00.000Z";
    setNow(now);
    const seed = (person: typeof admin.user, day: string, quantity = 2) =>
      writeTransaction(database, (scope) =>
        createOrder(
          scope,
          person,
          {
            service: "Example meals",
            delivery_date: day,
            status: "scheduled",
            meals: [{ name: "Example bowl", chef: "Example chef", quantity }],
          },
          mealNutritionKinds,
          now,
        ),
      );
    const list = async (person = admin) => {
      const response = await person.request("/api/meals/on-hand");
      assert.equal(response.status, 200);
      return (await response.json()).meals;
    };
    const mark = (order_id: number, person = admin) =>
      person.request("/api/orders/mark-delivery", {
        method: "POST",
        body: JSON.stringify({ order_id }),
      });
    assert.deepEqual(await list(), []);
    const due = seed(admin.user, "2026-01-02");
    const future = seed(admin.user, "2026-01-03", 0);
    const early = seed(admin.user, "2026-01-04");
    database
      .prepare("UPDATE users SET timezone = ? WHERE id = ?")
      .run("UTC", member.user.id);
    const foreign = seed(member.user, "2026-01-02");
    assert.throws(() => seed(admin.user, "2026-01-02"), /UNIQUE/);
    assert.notEqual(foreign.id, due.id);
    assert.throws(
      () =>
        database
          .prepare(
            "INSERT INTO order_meals (user_id, order_id, name, quantity, updated_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(member.user.id, due.id, "Example bowl", 1, now),
      /FOREIGN KEY/,
    );
    for (const [instant, delivered_at, expected] of [
      [now, null, false],
      ["2026-01-01T22:30:00.000Z", null, true],
      [now, now, true],
    ] as const)
      assert.equal(
        isDue({ ...due, delivered_at }, admin.user, instant),
        expected,
      );
    assert.deepEqual(await list(), []);
    now = "2026-01-01T22:30:00.000Z";
    setNow(now);
    const [meal] = await list();
    assert.deepEqual(meal, {
      id: 1,
      order_id: due.id,
      name: "Example bowl",
      chef: "Example chef",
      quantity: 2,
      revision: 1,
      delivery_date: "2026-01-02",
    });
    let revision = 1;
    for (const changes of [
      { quantity: 3 },
      { name: "Example plate" },
      { chef: null },
      { chef: null },
    ]) {
      const updated: UpdateOrderMealResult | null = writeTransaction(
        database,
        (scope) => updateMeal(scope, admin.user.id, meal.id, changes, now),
      );
      assert.ok(updated);
      assert.equal(updated?.revision, ++revision);
      for (const [field, value] of Object.entries(changes))
        assert.equal(Reflect.get(updated, field), value);
    }
    assert.equal(
      writeTransaction(database, (scope) =>
        updateMeal(scope, member.user.id, meal.id, { quantity: 0 }),
      ),
      null,
    );
    const foreignMark = await mark(due.id, member);
    assert.equal(foreignMark.status, 404);
    assert.equal(
      selectOrder(database, { user_id: admin.user.id, id: due.id })
        ?.delivered_at,
      null,
    );
    assert.deepEqual(await list(member), []);
    assert.equal((await mark(999999)).status, 404);
    for (const body of [{}, { order_id: "bad" }, { order_id: 0 }]) {
      assert.equal(
        (
          await admin.request("/api/orders/mark-delivery", {
            method: "POST",
            body: JSON.stringify(body),
          })
        ).status,
        400,
      );
    }
    assert.deepEqual(await (await mark(early.id)).json(), {
      order_id: early.id,
      delivered_at: now,
    });
    const before = await list();
    assert.deepEqual(
      before.map((entry: { order_id: number }) => entry.order_id),
      [due.id, early.id],
    );
    const rows = () =>
      JSON.stringify(
        database.prepare("SELECT * FROM order_meals ORDER BY id").all(),
      );
    const mealsBefore = rows();
    context.mock.timers.enable({
      apis: ["Date", "setTimeout"],
      now: new Date(now),
    });
    const job = createOrderMaintenanceJob({
      database,
      clock: { now: () => new Date(now) },
    });
    const runner = createJobRunner({
      database,
      timezone: "UTC",
      clock: { now: () => new Date(now) },
      report: assert.fail,
    });
    context.after(async () => {
      context.mock.timers.reset();
      await runner.stop();
    });
    runner.register(job);
    runner.start();
    const result = await runner.runNow(job.name);
    assert.equal(result.status, "ok");
    for (const [order, expected] of [
      [due, now],
      [future, null],
      [early, now],
      [foreign, null],
    ] as const) {
      assert.equal(
        selectOrder(database, { user_id: order.user_id, id: order.id })
          ?.delivered_at,
        expected,
        `delivery date ${order.delivery_date}`,
      );
    }
    if ("detail" in result)
      assert.equal(result.detail, "deliveries_recorded:1");
    assert.equal(rows(), mealsBefore);
    assert.deepEqual(await list(), before);
    now = "2026-01-01T23:00:00.000Z";
    setNow(now);
    assert.equal((await runner.runNow(job.name)).status, "ok");
    assert.equal(
      (await (await mark(early.id)).json()).delivered_at,
      "2026-01-01T22:30:00.000Z",
    );
    assert.equal(rows(), mealsBefore);
    await mark(foreign.id, member);
    assert.deepEqual(
      (await list(member)).map((entry: { order_id: number }) => entry.order_id),
      [foreign.id],
    );
    const emptyMeal = database
      .prepare("SELECT id FROM order_meals WHERE order_id = ?")
      .pluck()
      .get(future.id) as number;
    assert.ok(
      selectOrderMeal(database, { user_id: admin.user.id, id: emptyMeal }),
    );
    await mark(future.id);
    assert.deepEqual(await list(), before);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(job.run({ signal: controller.signal }), {
      name: "AbortError",
    });
    const stopping = runner.stop();
    context.mock.timers.tick(0);
    await stopping;
  });
}
