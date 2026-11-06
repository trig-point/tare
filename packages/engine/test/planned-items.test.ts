import assert from "node:assert/strict";
import { writeTransaction } from "../src/db.ts";
import { mealNutritionKinds } from "../src/meal-nutrition/index.ts";
import { actOnPlannedItem } from "../src/orders/eat.ts";
import { createOrder } from "../src/orders/index.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

for (const mode of ["fallback", "access"] as const) {
  test(`${mode}: planned items preserve ownership, due dates, budgets and replacement identity`, async (context) => {
    const { database, admin, member, setNow } = await twoUsers(context, mode);
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
    const { template: actionTemplate } = await send(
      "plan/templates",
      {
        action: "create",
        name: "Action day",
        slots: [
          { name: "Breakfast", start_minute: 0, end_minute: 900, share: 50 },
          { name: "Dinner", start_minute: 900, end_minute: 1440, share: 50 },
        ],
      },
      201,
    );
    const { day_type: actionType } = await send(
      "plan/day-types",
      {
        action: "create",
        name: "Action type",
        template_id: actionTemplate.id,
      },
      201,
    );
    await send("plan/day-type", { day_type_id: actionType.id });
    const place = async (
      reference = { food_id: food, servings: 2 } as {
        food_id?: number;
        servings?: number;
        meal_id?: number;
      },
    ) => (await plan({ position: 1, ...reference }, 201)).item;
    const input = (
      item: { id: number; revision: number },
      mutation_id: string,
      action = "ate",
    ) => ({ item_id: item.id, revision: item.revision, action, mutation_id });
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
    const reject = async (
      body: unknown,
      code: string,
      status = 409,
      person = admin,
    ) => {
      const beforeAction = snapshot();
      await sendFor(person)("plan/items/action", body, status, code);
      assert.deepEqual(snapshot(), beforeAction);
    };
    const open = await place();
    await reject(input(open, "foreign"), "planned_item_not_found", 404, member);
    if (mode === "access") return;
    const act = (body: unknown) => send("plan/items/action", body);
    const apply = (
      request: Parameters<typeof actOnPlannedItem>[2],
      time = now,
      person = admin.user,
    ) =>
      writeTransaction(database, (scope) =>
        actOnPlannedItem(scope, person, request, time),
      );
    const question = (await send("questions")).questions[0];
    await send("questions/answer", {
      id: question.id,
      answer: {
        kcal: 800,
        protein_g: 40,
        carbs_g: 80,
        fat_g: 20,
        source: "Example label",
      },
    });
    const mealReference = { meal_id: due };
    for (const [reference, action, kcal, quantity] of [
      [{ food_id: food, servings: 2 }, "ate", 200, null],
      [{ food_id: food, servings: 2 }, "ate_three_quarters", 150, null],
      [mealReference, "ate", 800, 1],
      [mealReference, "ate_three_quarters", 600, 0],
    ] as const) {
      const item = kcal === 200 ? open : await place(reference);
      const result = await act(input(item, `eat-${kcal}`, action));
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
          result.meal?.quantity ?? null,
        ],
        [kcal, item.template_id, 1, null, quantity],
      );
    }
    const request = input(open, "eat-200");
    const receipt = await act(request);
    const replacement = await place();
    const beforeReplay = snapshot();
    assert.deepEqual(await act(request), receipt);
    assert.deepEqual(await act({ ...request, revision: 99 }), receipt);
    assert.deepEqual(
      apply({ ...request, action: "ate" }, "2026-01-02T00:00:00.000Z"),
      receipt,
    );
    assert.deepEqual(snapshot(), beforeReplay);
    await reject(input(receipt.item, "handled"), "stale_revision");
    await reject({ ...request, action: "skip" }, "mutation_conflict");
    await reject({ ...request, item_id: replacement.id }, "mutation_conflict");
    await send(
      "intake",
      { client_id: "example-collision", name: "Example snack", kcal: 77 },
      201,
    );
    await reject(input(replacement, "example-collision"), "mutation_conflict");
    const boundary = {
      ...input(replacement, "boundary", "skip"),
      action: "skip" as const,
    };
    const boundaryPerson = {
      ...admin.user,
      timezone: "Europe/Warsaw",
      day_start_hour: 1,
    };
    const beforeBoundary = snapshot();
    assert.throws(
      () => apply(boundary, "2026-01-02T00:00:00.000Z", boundaryPerson),
      /planned_item_not_today/,
    );
    assert.deepEqual(snapshot(), beforeBoundary);
    database
      .prepare("UPDATE planned_items SET day = '2026-01-02' WHERE id = ?")
      .run(replacement.id);
    apply(boundary, "2026-01-02T00:00:00.000Z", boundaryPerson);
    setNow("2026-01-02T00:00:00.000Z");
    await send("plan/day-type", { day_type_id: actionType.id });
    assert.equal((await read()).planned_items[0].state, "skipped");
    setNow(now);
    const planView = await read();
    assert.deepEqual(
      new Set(
        planView.planned_items.map((item: { state: string }) => item.state),
      ),
      new Set(["eaten"]),
    );
    assert.deepEqual(
      planView.budgets.slots.map(
        (slot: { kcal: { intake: number } }) => slot.kcal.intake,
      ),
      [77, 1750],
    );
    database
      .prepare("UPDATE order_meals SET quantity = 1 WHERE id = ?")
      .run(due);
    const blocked = await place(mealReference);
    const beforeAction = snapshot();
    database.exec(
      "CREATE TRIGGER fail_action BEFORE INSERT ON meal_actions BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );
    assert.throws(
      () => apply({ ...input(blocked, "rollback"), action: "ate" }),
      /injected failure/,
    );
    assert.deepEqual(snapshot(), beforeAction);
    database.exec("DROP TRIGGER fail_action");
    database
      .prepare(
        "UPDATE planned_items SET template_id = NULL, position = NULL WHERE id = ?",
      )
      .run(blocked.id);
    database
      .prepare("UPDATE order_meals SET quantity = 0 WHERE id = ?")
      .run(due);
    await reject(input(blocked, "stock"), "meal_out_of_stock");
    const beforeSkip = snapshot();
    const skipped = await act(input(blocked, "skip", "skip"));
    assert.deepEqual(
      [skipped.item.state, skipped.item.revision, skipped.entry, skipped.meal],
      ["skipped", 2, null, null],
    );
    assert.deepEqual(snapshot().slice(1, 3), beforeSkip.slice(1, 3));
    const insert = database.prepare(
      "INSERT INTO meal_actions (user_id, mutation_id, planned_item_id, order_meal_id, intake_entry_id, action, result, created_at) VALUES (?, ?, ?, ?, ?, ?, '{}', ?)",
    );
    for (const [index, [action, item, mealId, intake, valid]] of (
      [
        ["ate", null, due, 999999, true],
        ["ate_three_quarters", blocked.id, due, 999999, true],
        ["ate", blocked.id, null, 999999, true],
        ["skip", blocked.id, null, null, true],
        ["skip", null, null, null, false],
        ["skip", blocked.id, due, null, false],
        ["skip", blocked.id, null, 999999, false],
      ] as const
    ).entries()) {
      const write = () =>
        insert.run(
          admin.user.id,
          `shape-${index}`,
          item,
          mealId,
          intake,
          action,
          now,
        );
      if (valid) assert.equal(write().changes, 1);
      else assert.throws(write, /CHECK/);
    }
  });
}
