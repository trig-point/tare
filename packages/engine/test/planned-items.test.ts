import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyMigrations, writeTransaction } from "../src/db.ts";
import { mealNutritionKinds } from "../src/meal-nutrition/index.ts";
import { actOnPlannedItem } from "../src/orders/eat.ts";
import { createOrder } from "../src/orders/index.ts";
import { insertAgentToken } from "../src/queries/insert-agent-token.ts";
import { assertionHeader, signAccessToken } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

for (const mode of ["fallback", "access"] as const) {
  test(`${mode}: planned items preserve ownership, due dates, budgets and replacement identity`, async (context) => {
    const { app, database, admin, member, setNow } = await twoUsers(
      context,
      mode,
    );
    database.exec(
      "UPDATE users SET timezone = 'America/New_York', day_start_hour = 20",
    );
    const sendFor =
      (person = admin) =>
      async (path: string, body?: unknown, status = 200, code?: string) => {
        const response = await person.request(
          `/api/${path}`,
          body === undefined
            ? {}
            : { method: "POST", body: JSON.stringify(body) },
        );
        const result = await response.json();
        assert.equal(response.status, status, JSON.stringify(result));
        if (code) assert.deepEqual(result, { error: { code } });
        return result;
      };
    const send = sendFor(),
      other = sendFor(member);
    const rows = () =>
      database.prepare("SELECT * FROM planned_items ORDER BY id").all();
    const attachment = (id: number) =>
      database
        .prepare(
          "SELECT template_id, position, revision FROM planned_items WHERE id = ?",
        )
        .get(id);
    const read = () => send("plan");
    const plan = (body: unknown, status = 200, code?: string) =>
      send("plan/slot", body, status, code);
    const slots = [
      { name: "Dinner", start_minute: 0, end_minute: 1440, share: 100 },
    ];
    assert.deepEqual((await read()).planned_items, []);
    await plan({ position: 0, food_id: 1 }, 409, "no_day_type");
    const { template } = await send(
      "plan/templates",
      { action: "create", name: "Example day", slots },
      201,
    );
    const { day_type } = await send(
      "plan/day-types",
      { action: "create", name: "Example type", template_id: template.id },
      201,
    );
    await send("plan/day-type", { day_type_id: day_type.id });
    await send("profile", {
      height_cm: 180,
      birth_date: "1986-01-01",
      sex: "male",
      activity_level: "moderate",
      goal_rate_kg_week: -0.5,
    });
    await send("weights", { client_id: "example", weight_kg: 80 }, 201);
    const food = Number(
      database
        .prepare(
          "INSERT INTO foods (user_id, name, kcal, provenance) VALUES (?, 'Example soup', 100, 'estimated')",
        )
        .run(admin.user.id).lastInsertRowid,
    );
    const meal = (delivery_date: string, quantity = 2) =>
      writeTransaction(database, (scope) => {
        const order = createOrder(
          scope,
          admin.user,
          {
            service: `Example service ${delivery_date}`,
            delivery_date,
            status: "scheduled",
            meals: [{ name: "Example bowl", chef: null, quantity }],
          },
          mealNutritionKinds,
          "2026-01-01T00:00:00.000Z",
        );
        return (
          database
            .prepare("SELECT id FROM order_meals WHERE order_id = ?")
            .get(order.id) as { id: number }
        ).id;
      });
    const due = meal("2025-12-30"),
      future = meal("2025-12-31"),
      empty = meal("2026-01-01", 0);
    for (const body of [
      {},
      { position: 0, food_id: food, meal_id: due },
      { position: 0, meal_id: due, servings: 1 },
      { position: 0, food_id: food, item_id: 1 },
      { position: 0, food_id: food, revision: 1 },
      { position: 0, food_id: food, servings: 0 },
    ])
      await plan(body, 400, "invalid_request");
    await plan({ position: 1, food_id: food }, 400, "slot_not_found");
    await plan({ position: 0, food_id: 999999 }, 404, "food_not_found");
    await plan({ position: 0, meal_id: 999999 }, 404, "meal_not_found");
    await plan({ position: 0, meal_id: empty }, 409, "meal_out_of_stock");
    await plan({ position: 0, meal_id: future }, 409, "meal_not_due");
    await plan(
      { position: 0, food_id: food, item_id: 999999, revision: 1 },
      409,
      "stale_revision",
    );
    assert.equal(
      database.prepare("SELECT count(*) FROM planned_items").pluck().get(),
      0,
    );
    const before = await send("plan/today");
    const { item: first } = await plan({ position: 0, meal_id: due }, 201);
    assert.deepEqual(first, {
      id: first.id,
      revision: 1,
      state: "planned",
      template_id: template.id,
      position: 0,
      reference: { kind: "meal", id: due, name: "Example bowl" },
      servings: null,
      nutrition: { status: "pending" },
    });
    assert.deepEqual(await read(), { ...before, planned_items: [first] });
    assert.equal(before.budgets.status, "ready");
    assert.equal(
      database
        .prepare(
          "SELECT delivered_at FROM orders WHERE delivery_date = '2025-12-30'",
        )
        .pluck()
        .get(),
      null,
    );
    assert.equal(
      database
        .prepare("SELECT quantity FROM order_meals WHERE id = ?")
        .pluck()
        .get(due),
      2,
    );
    assert.equal(
      database.prepare("SELECT count(*) FROM intake_entries").pluck().get(),
      0,
    );
    const replace = {
      position: 0,
      food_id: food,
      item_id: first.id,
      revision: first.revision,
    };
    await plan({ position: 0, food_id: food }, 409, "stale_revision");
    const { item: second } = await plan(replace);
    assert.equal(second.id, first.id);
    assert.equal(second.revision, 2);
    assert.deepEqual(
      [second.reference, second.servings, second.nutrition],
      [
        { kind: "food", id: food, name: "Example soup" },
        1,
        { status: "known" },
      ],
    );
    await plan(replace, 409, "stale_revision");
    const unchanged = rows();
    setNow("2026-01-01T00:00:30.000Z");
    assert.deepEqual((await plan({ ...replace, revision: 2 })).item, second);
    assert.deepEqual(rows(), unchanged);
    database
      .prepare("UPDATE planned_items SET day = '2025-12-29' WHERE id = ?")
      .run(first.id);
    const yesterday = rows()[0];
    await plan({ ...replace, revision: 2 }, 409, "stale_revision");
    assert.deepEqual(rows()[0], yesterday);
    const { item: today } = await plan({ position: 0, food_id: food }, 201);
    assert.notEqual(today.id, first.id);
    assert.deepEqual(rows()[0], yesterday);
    assert.deepEqual((await read()).planned_items, [today]);
    const foreignTemplate = await other(
      "plan/templates",
      { action: "create", name: "Other day", slots },
      201,
    );
    const foreignType = await other(
      "plan/day-types",
      {
        action: "create",
        name: "Other type",
        template_id: foreignTemplate.template.id,
      },
      201,
    );
    await other("plan/day-type", { day_type_id: foreignType.day_type.id });
    for (const [field, id, code] of [
      ["meal_id", due, "meal_not_found"],
      ["food_id", food, "food_not_found"],
    ] as const) {
      await other("plan/slot", { position: 0, [field]: id }, 404, code);
    }
    assert.deepEqual((await other("plan")).planned_items, []);
    assert.throws(
      () =>
        database
          .prepare(
            "INSERT INTO planned_items (user_id, day, template_id, position, food_id, servings, created_at, updated_at) SELECT user_id, day, template_id, position, food_id, servings, created_at, updated_at FROM planned_items",
          )
          .run(),
      /UNIQUE/,
    );
    assert.throws(
      () =>
        database
          .prepare("UPDATE planned_items SET user_id = ? WHERE id = ?")
          .run(member.user.id, first.id),
      /FOREIGN KEY/,
    );
    await send("plan/templates", {
      action: "update",
      id: template.id,
      name: "Updated day",
      slots,
    });
    assert.deepEqual((await read()).planned_items, []);
    assert.deepEqual(attachment(first.id), {
      template_id: null,
      position: null,
      revision: 3,
    });
    const { item: third } = await plan({ position: 0, food_id: food }, 201);
    assert.notEqual(third.id, first.id);
    await plan({ ...replace, revision: 1 }, 409, "stale_revision");
    assert.deepEqual((await read()).planned_items, [third]);
    database
      .prepare("UPDATE planned_items SET state = 'eaten' WHERE id = ?")
      .run(third.id);
    const { item: fourth } = await plan({ position: 0, food_id: food }, 201);
    assert.notEqual(fourth.id, third.id);
    assert.deepEqual((await read()).planned_items, [
      { ...third, state: "eaten" },
      fourth,
    ]);
    database.exec(
      "DELETE FROM day_type_choices; DELETE FROM default_day_types",
    );
    await send("plan/day-types", { action: "delete", id: day_type.id });
    await send("plan/templates", { action: "delete", id: template.id });
    assert.deepEqual((await read()).planned_items, []);
    assert.deepEqual(attachment(third.id), {
      template_id: null,
      position: null,
      revision: 1,
    });
    assert.deepEqual(attachment(fourth.id), {
      template_id: null,
      position: null,
      revision: 2,
    });
    const now = "2026-01-01T00:00:00.000Z";
    setNow(now);
    database.exec("UPDATE users SET timezone = 'UTC', day_start_hour = 0");
    if (mode === "access") {
      const client_id = "example-planned-agent";
      insertAgentToken(database, {
        client_id,
        user_id: admin.user.id,
        name: "Example agent",
        created_at: now,
      });
      const token = await signAccessToken({
        sub: "",
        common_name: client_id,
      });
      admin.request = async (path, init = {}) =>
        app.request(path, { ...init, headers: assertionHeader(token) });
    }
    const scalar = (sql: string, ...params: (number | string)[]) =>
      database
        .prepare(sql)
        .pluck()
        .get(...params);
    const run = (sql: string, ...params: (number | string)[]) =>
      database.prepare(sql).run(...params);
    const apply = (
      request: Parameters<typeof actOnPlannedItem>[2],
      person = admin.user,
      time = now,
    ) =>
      writeTransaction(database, (scope) =>
        actOnPlannedItem(scope, person, request, time),
      );
    const api = (path: string, body?: unknown, person = admin, status = 200) =>
      sendFor(person)(path, body, status);
    const actionSlots = [
      { name: "Breakfast", start_minute: 0, end_minute: 900, share: 50 },
      { name: "Dinner", start_minute: 900, end_minute: 1440, share: 50 },
    ];
    for (const person of [admin, member]) {
      const { template } = await api(
        "plan/templates",
        { action: "create", name: "Example day", slots: actionSlots },
        person,
        201,
      );
      const { day_type } = await api(
        "plan/day-types",
        { action: "create", name: "Example type", template_id: template.id },
        person,
        201,
      );
      await api("plan/day-type", { day_type_id: day_type.id }, person);
    }
    let sequence = 0;
    const makeMeal = async () => {
      const order = writeTransaction(database, (scope) =>
        createOrder(
          scope,
          admin.user,
          {
            service: `Example service ${sequence++}`,
            delivery_date: "2026-01-01",
            status: "scheduled",
            meals: [{ name: "Example bowl", chef: null, quantity: 20 }],
          },
          mealNutritionKinds,
          now,
        ),
      );
      const question = (await api("questions")).questions.at(-1);
      await api("questions/answer", {
        id: question.id,
        answer: {
          kcal: 800,
          protein_g: 40,
          carbs_g: 80,
          fat_g: 20,
          source: "Example label",
        },
      });
      return Number(
        scalar("SELECT id FROM order_meals WHERE order_id = ?", order.id),
      );
    };
    const actionMeal = await makeMeal();
    const snapshot = () =>
      [
        "planned_items",
        "intake_entries",
        "order_meals",
        "meal_actions",
        "days",
        "orders",
      ].map((table) =>
        database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      );
    const place = async (
      reference: { food_id?: number; servings?: number; meal_id?: number } = {
        food_id: food,
        servings: 2,
      },
      person = admin,
    ) =>
      (await api("plan/slot", { position: 1, ...reference }, person, 201)).item;
    const input = (
      item: { id: number; revision: number },
      mutation_id: string,
      action = "ate",
    ) => ({ item_id: item.id, revision: item.revision, action, mutation_id });
    const act = (body: unknown, person = admin, status = 200) =>
      api("plan/items/action", body, person, status);
    const reject = async (
      body: unknown,
      code: string,
      status = 409,
      person = admin,
    ) => {
      const beforeAction = snapshot();
      assert.deepEqual(await act(body, person, status), { error: { code } });
      assert.deepEqual(snapshot(), beforeAction);
    };
    const mealReference = { meal_id: actionMeal };
    for (const [reference, action, kcal] of [
      [mealReference, "ate", 800],
      [mealReference, "ate_three_quarters", 600],
      [{ food_id: food, servings: 2 }, "ate", 200],
      [{ food_id: food, servings: 2 }, "ate_three_quarters", 150],
    ] as const) {
      const item = await place(reference);
      const request = input(item, `eat-${kcal}`, action);
      const result = await act(request);
      assert.deepEqual(result.item, {
        id: item.id,
        revision: 2,
        state: "eaten",
      });
      assert.deepEqual(
        [
          result.entry.kcal,
          result.entry.slot_template_id,
          result.entry.slot_position,
          result.entry.fiber_g,
        ],
        [kcal, item.template_id, 1, null],
      );
      assert.equal(
        result.meal?.quantity ?? null,
        kcal === 800 ? 19 : kcal === 600 ? 18 : null,
      );
      const replacement = await place();
      const beforeAction = snapshot();
      assert.deepEqual(await act(request), result);
      assert.deepEqual(await act({ ...request, revision: 99 }), result);
      assert.deepEqual(snapshot(), beforeAction);
      if (kcal === 150) {
        run("UPDATE foods SET kcal = 300 WHERE id = ?", food);
        run(
          "UPDATE planned_items SET template_id = NULL, position = NULL WHERE id = ?",
          item.id,
        );
        assert.deepEqual(
          apply(
            { ...request, action, revision: 99 },
            admin.user,
            "2026-01-02T00:00:00.000Z",
          ),
          result,
        );
        run("UPDATE foods SET kcal = 100 WHERE id = ?", food);
      }
      await reject(input(result.item, `handled-${kcal}`), "stale_revision");
      await reject({ ...request, action: "skip" }, "mutation_conflict");
      await reject(
        { ...request, item_id: replacement.id },
        "mutation_conflict",
      );
      await act(input(replacement, `clear-${kcal}`, "skip"));
    }
    const planView = await api("plan");
    assert.equal(planView.planned_items.length, 7);
    assert.deepEqual(
      new Set(
        planView.planned_items.map((item: { state: string }) => item.state),
      ),
      new Set(["eaten", "skipped"]),
    );
    assert.deepEqual(
      planView.budgets.slots.map(
        (slot: { kcal: { intake: number } }) => slot.kcal.intake,
      ),
      [0, 1750],
    );
    assert.equal(
      scalar(
        "SELECT delivered_at FROM orders WHERE id = (SELECT order_id FROM order_meals WHERE id = ?)",
        actionMeal,
      ),
      null,
    );
    run("UPDATE order_meals SET quantity = 100 WHERE id = ?", actionMeal);
    const modelReceipts = new Map<
      string,
      {
        request: ReturnType<typeof input>;
        result: Awaited<ReturnType<typeof act>>;
      }
    >();
    let current = await place(),
      seed = 201,
      acceptedEats = 0,
      acceptedMeals = 0;
    let expected = { state: "planned", revision: 1 };
    const intakeBefore = Number(scalar("SELECT count(*) FROM intake_entries"));
    for (let step = 0; step < 72; step++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const prior = [...modelReceipts.values()][seed % modelReceipts.size];
      const request =
        step % 3 === 0 && prior
          ? { ...prior.request, revision: 1 + (seed % 5) }
          : {
              ...input(
                current,
                `model-${step}`,
                ["ate", "ate_three_quarters", "skip"][seed % 3],
              ),
              revision: seed % 4 === 0 ? 9 : 1,
            };
      const recorded = modelReceipts.get(request.mutation_id);
      const beforeAction = snapshot();
      if (recorded) {
        assert.deepEqual(await act(request), recorded.result);
        assert.deepEqual(snapshot(), beforeAction);
      } else if (
        expected.state !== "planned" ||
        request.revision !== expected.revision
      ) {
        await reject(request, "stale_revision");
      } else {
        const result = await act(request);
        expected.state = request.action === "skip" ? "skipped" : "eaten";
        expected.revision++;
        assert.deepEqual(result.item, { id: request.item_id, ...expected });
        if (request.action !== "skip") {
          acceptedEats++;
          if (current.reference.kind === "meal") acceptedMeals++;
          assert.equal(
            result.entry.kcal,
            (current.reference.kind === "meal" ? 800 : 200) *
              (request.action === "ate" ? 1 : 0.75),
          );
        } else {
          assert.deepEqual(result.entry, null);
        }
        modelReceipts.set(request.mutation_id, {
          request,
          result: structuredClone(result),
        });
      }
      assert.equal(
        scalar("SELECT count(*) FROM intake_entries"),
        intakeBefore + acceptedEats,
      );
      assert.equal(
        scalar("SELECT quantity FROM order_meals WHERE id = ?", actionMeal),
        100 - acceptedMeals,
      );
      assert.deepEqual(
        database
          .prepare("SELECT state, revision FROM planned_items WHERE id = ?")
          .get(request.item_id),
        recorded
          ? {
              state: recorded.result.item.state,
              revision: recorded.result.item.revision,
            }
          : expected,
      );
      if (step % 4 === 0 && expected.state !== "planned") {
        current = await place(step % 8 === 0 ? mealReference : undefined);
        expected = { state: "planned", revision: 1 };
      }
    }
    if (expected.state === "planned")
      await act(input(current, "model-clear", "skip"));
    const open = await place();
    for (const invalid of [
      {},
      { ...input(open, "bad"), mutation_id: " " },
      { ...input(open, "bad"), action: "unknown" },
      { ...input(open, "bad"), revision: 0 },
      { ...input(open, "bad"), extra: true },
    ])
      await reject(invalid, "invalid_request", 400);
    await reject(input(open, "foreign"), "planned_item_not_found", 404, member);
    await reject(
      { ...input(open, "missing"), item_id: 999999 },
      "planned_item_not_found",
      404,
    );
    await reject({ ...input(open, "stale"), revision: 2 }, "stale_revision");
    await api(
      "intake",
      { client_id: "example-collision", name: "Example snack", kcal: 77 },
      admin,
      201,
    );
    await reject(input(open, "example-collision"), "mutation_conflict");
    const boundaryPerson = {
      ...admin.user,
      timezone: "Europe/Warsaw",
      day_start_hour: 1,
    };
    const boundary = { ...input(open, "boundary"), action: "skip" as const };
    const beforeBoundary = snapshot();
    assert.throws(
      () => apply(boundary, boundaryPerson, "2026-01-02T00:00:00.000Z"),
      /planned_item_not_today/,
    );
    assert.deepEqual(snapshot(), beforeBoundary);
    run("UPDATE planned_items SET day = '2026-01-02' WHERE id = ?", open.id);
    apply(boundary, boundaryPerson, "2026-01-02T00:00:00.000Z");
    const blocked = await place(mealReference);
    run(
      "UPDATE planned_items SET template_id = NULL, position = NULL WHERE id = ?",
      blocked.id,
    );
    for (const [change, code] of [
      ["UPDATE order_meals SET quantity = 0", "meal_out_of_stock"],
      [
        "UPDATE order_meals SET quantity = 18; UPDATE orders SET delivery_date = '2026-01-02'",
        "meal_not_due",
      ],
      ["UPDATE orders SET delivery_date = '2026-01-01'", "slot_not_found"],
    ] as const) {
      database.exec(change);
      await reject(
        input(blocked, code),
        code,
        code === "slot_not_found" ? 400 : 409,
      );
    }
    database.exec(
      "UPDATE foods SET meal_key = NULL, service = NULL, meal_name = NULL, chef = NULL WHERE meal_key IS NOT NULL",
    );
    await reject(input(blocked, "unknown"), "meal_nutrition_missing");
    database.exec(
      "UPDATE questions SET status = 'open' WHERE kind = 'meal_nutrition'",
    );
    await reject(input(blocked, "pending"), "meal_nutrition_pending");
    database.exec("UPDATE order_meals SET quantity = 0");
    const stock = database.prepare("SELECT * FROM order_meals").all();
    const skipped = await act(input(blocked, "shared", "skip"));
    assert.deepEqual(
      [skipped.item.state, skipped.item.revision, skipped.entry, skipped.meal],
      ["skipped", 2, null, null],
    );
    assert.deepEqual(
      database.prepare("SELECT * FROM order_meals").all(),
      stock,
    );
    await reject(input(skipped.item, "handled-skip"), "stale_revision");
    const otherFood = Number(
      database
        .prepare(
          "INSERT INTO foods (user_id, name, kcal, provenance) VALUES (?, 'Example fruit', 50, 'estimated')",
        )
        .run(member.user.id).lastInsertRowid,
    );
    const otherItem = await place({ food_id: otherFood, servings: 1 }, member);
    assert.equal(
      (await act(input(otherItem, "shared", "skip"), member)).item.state,
      "skipped",
    );
    database.exec(
      "UPDATE questions SET status = 'answered' WHERE kind = 'meal_nutrition'",
    );
    const collisionMeal = await makeMeal();
    const direct = {
      meal_id: collisionMeal,
      revision: 1,
      action: "ate" as const,
      mutation_id: "direct",
    };
    const directResult = await api("meals/eat", direct);
    const rollback = await place({ meal_id: collisionMeal });
    await reject(input(rollback, "direct"), "mutation_conflict");
    assert.deepEqual(
      await api(
        "meals/eat",
        { ...direct, meal_id: actionMeal, revision: 2, mutation_id: "eat-800" },
        admin,
        409,
      ),
      { error: { code: "mutation_conflict" } },
    );
    const beforeAction = snapshot();
    database.exec(
      "CREATE TRIGGER fail_action BEFORE INSERT ON meal_actions BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );
    assert.throws(
      () => apply({ ...input(rollback, "rollback"), action: "ate" }),
      /injected failure/,
    );
    assert.deepEqual(snapshot(), beforeAction);
    database.exec("DROP TRIGGER fail_action");
    if (mode === "fallback") {
      const legacyResult = structuredClone(directResult);
      delete legacyResult.entry.slot_template_id;
      delete legacyResult.entry.slot_position;
      const bytes = ` ${JSON.stringify(legacyResult)} `;
      database
        .prepare(
          "UPDATE meal_actions SET result = ? WHERE mutation_id = 'direct'",
        )
        .run(bytes);
      database.exec("ALTER TABLE meal_actions RENAME TO old_actions");
      database.exec(
        readFileSync(
          new URL("../migrations/0017_meal_actions.sql", import.meta.url),
          "utf8",
        ),
      );
      database.exec(
        "INSERT INTO meal_actions SELECT user_id, mutation_id, order_meal_id, action, intake_entry_id, result, created_at FROM old_actions WHERE mutation_id = 'direct'; DROP TABLE old_actions; DELETE FROM schema_migrations WHERE name = '0024_meal_actions.sql'",
      );
      const original = database.prepare("SELECT * FROM meal_actions").get();
      applyMigrations(database);
      assert.deepEqual(database.prepare("SELECT * FROM meal_actions").get(), {
        ...(original as object),
        planned_item_id: null,
      });
      assert.deepEqual(database.pragma("foreign_key_check"), []);
      assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
      assert.deepEqual(await api("meals/eat", direct), legacyResult);
      const insert = database.prepare(
        "INSERT INTO meal_actions (user_id, mutation_id, planned_item_id, order_meal_id, intake_entry_id, action, result, created_at) VALUES (?, ?, ?, ?, ?, ?, '{}', ?)",
      );
      for (const [action, item, mealId, intake, error] of [
        ["ate", null, actionMeal, 999999, null],
        ["ate_three_quarters", rollback.id, actionMeal, 999999, null],
        ["ate", rollback.id, null, 999999, null],
        ["skip", rollback.id, null, null, null],
        ["skip", null, null, null, /CHECK/],
        ["skip", rollback.id, actionMeal, null, /CHECK/],
        ["skip", rollback.id, null, 999999, /CHECK/],
        ["ate", null, null, 999999, /CHECK/],
        ["ate", null, actionMeal, null, /CHECK/],
        ["skip", otherItem.id, null, null, /FOREIGN KEY/],
      ] as const) {
        const write = () =>
          insert.run(
            admin.user.id,
            `shape-${sequence++}`,
            item,
            mealId,
            intake,
            action,
            now,
          );
        if (error) assert.throws(write, error);
        else assert.equal(write().changes, 1);
      }
      assert.throws(
        () =>
          insert.run(
            admin.user.id,
            "direct",
            rollback.id,
            null,
            null,
            "skip",
            now,
          ),
        /UNIQUE/,
      );
    }
  });
}
