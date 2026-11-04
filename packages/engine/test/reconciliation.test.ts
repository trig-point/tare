import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { writeTransaction } from "../src/db.ts";
import { createOrderEmailParseJob } from "../src/inbound/job.ts";
import { createOrderQuestionKinds } from "../src/inbound/questions.ts";
import { reconcileEmail } from "../src/inbound/reconcile.ts";
import { eatOrderMeal } from "../src/orders/eat.ts";
import { listMealsOnHand } from "../src/orders/index.ts";
import { listMealCandidates } from "../src/queries/orders/list-meal-candidates.ts";
import { listReconcileMeals } from "../src/queries/orders/list-reconcile-meals.ts";
import { selectDeliveryOrder } from "../src/queries/orders/select-delivery-order.ts";
import { selectQueuedInboundEmail } from "../src/queries/select-queued-inbound-email.ts";
import { selectReconcileEmail } from "../src/queries/select-reconcile-email.ts";
import { rejection } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const field = <Value>(value: Value) => ({
  value,
  excerpt: null,
  uncertain: false,
});
const parsedMeal = (quantity: number | null) => ({
  source_index: 0,
  name: field("Garden Bowl"),
  chef: field<string | null>("Example chef"),
  quantity: field(quantity),
});
const parse = (
  quantity: number | null = 2,
  kind = "scheduling",
  date: string | null = "2026-01-02",
) => ({
  status: "parsed",
  service: field("kit"),
  kind: field(kind),
  delivery_date: field(date),
  meals: [parsedMeal(quantity)] as [ReturnType<typeof parsedMeal>],
  uncertain: [] as string[],
  dropped: [] as string[],
});
const first = <Value>(values: Value[]) => {
  const value = values[0];
  assert.ok(value);
  return value;
};
async function setup(context: TestContext) {
  const fixture = await twoUsers(context, "fallback");
  const { database, admin } = fixture;
  let now = "2026-01-01T00:00:00.000Z",
    sequence = 0;
  const clock = { now: () => new Date(now) };
  const kinds = createOrderQuestionKinds({ clock });
  const seed = (
    result: unknown = parse(),
    person = admin,
    state = "parsed",
  ) => ({
    user_id: person.user.id,
    id: Number(
      database
        .prepare(
          "INSERT INTO inbound_emails (user_id, service, mark, dedupe_key, raw, subject_attached, parse_state, parse_result, created_at, updated_at) VALUES (?, 'kit', 'sender_matched', ?, ?, 0, ?, ?, ?, ?)",
        )
        .run(
          person.user.id,
          String(++sequence),
          Buffer.from("From: orders@kit.example.com\r\n\r\nGarden Bowl 2"),
          state,
          JSON.stringify(result),
          now,
          now,
        ).lastInsertRowid,
    ),
  });
  const run = (email: ReturnType<typeof seed>, person = admin) =>
    writeTransaction(database, (scope) =>
      reconcileEmail(scope, email, person.user, now, kinds),
    );
  const order = () => {
    const row = selectDeliveryOrder(database, {
      user_id: admin.user.id,
      service: "kit",
      delivery_date: "2026-01-02",
    });
    assert.ok(row);
    return row;
  };
  const meals = () =>
    listReconcileMeals(database, {
      user_id: admin.user.id,
      order_id: order().id,
    });
  const question = (email: ReturnType<typeof seed>) => {
    const rows = database
      .prepare<[string], { id: number; status: string }>(
        "SELECT id, status FROM questions WHERE subject_ref = ? AND kind = 'order_late_list'",
      )
      .all(String(email.id));
    assert.equal(rows.length, 1);
    return first(rows);
  };
  const answer = (id: number, value: unknown, person = admin) =>
    person.request("/api/questions/answer", {
      method: "POST",
      body: JSON.stringify({ id, answer: value }),
    });
  const setNow = (value: string) => {
    now = value;
    fixture.setNow(value);
  };
  return {
    ...fixture,
    clock,
    kinds,
    seed,
    run,
    order,
    meals,
    question,
    answer,
    setNow,
  };
}

test("chef carry-over, merged identities and ownership", async (context) => {
  const { database, member, seed, run, meals } = await setup(context);
  run(seed());
  const original = first(meals());
  const processed = parse(3, "processed");
  processed.meals[0].chef = field(null);
  processed.meals.push({
    ...processed.meals[0],
    source_index: 1,
    quantity: field(1),
  });
  const final = seed(processed);
  run(final);
  assert.deepEqual(
    meals().map((meal) => [meal.id, meal.quantity, meal.chef, meal.revision]),
    [[original.id, 4, "Example chef", 2]],
  );
  const foreign = seed(parse(), member);
  run(foreign, member);
  assert.equal(database.prepare("SELECT id FROM orders").all().length, 2);
});

test("pickup recovers once, defers incomplete rows and validates persisted data and mapper offsets", async (context) => {
  const fixture = await setup(context);
  const { database, admin, seed, clock, kinds } = fixture;
  const pending = [
    parse(null),
    parse(2, "processed", null),
    { ...parse(), meals: [] },
    { ...parse(), uncertain: ["delivery_date"] },
    { ...parse(), dropped: ["meals[0].chef"] },
    { ...parse(), kind: field(null) },
  ].map((result) => seed(result));
  for (const state of ["held", "no_model", "failed"])
    pending.push(seed({ status: state }, admin, state));
  const complete = seed(),
    queued = seed(parse(), admin, "queued");
  const mapped = selectQueuedInboundEmail(database, { after_id: 0 });
  assert.deepEqual(
    [mapped?.id, mapped?.timezone, mapped?.day_start_hour],
    [queued.id, admin.user.timezone, admin.user.day_start_hour],
  );
  database
    .prepare("UPDATE inbound_emails SET parse_state = 'held' WHERE id = ?")
    .run(queued.id);
  const job = createOrderEmailParseJob({
    database,
    clock,
    model: null,
    questionKinds: kinds,
  });
  for (let pass = 0; pass < 2; pass++)
    await job.run({ signal: new AbortController().signal });
  assert.equal(
    selectReconcileEmail(database, complete)?.disposition,
    "reconciled",
  );
  for (const email of pending)
    assert.equal(selectReconcileEmail(database, email)?.disposition, null);
  const malformed = seed({ status: "parsed" });
  assert.throws(() => fixture.run(malformed));
  assert.equal(selectReconcileEmail(database, malformed)?.disposition, null);
  assert.equal(first(fixture.meals()).revision, 1);
});

test("late lists preserve eaten stock and receipts; zero meals are hidden", async (context) => {
  const fixture = await setup(context);
  const { database, admin, member, seed, run, meals, answer, question } =
    fixture;
  run(seed());
  const nutrition = first(
    database
      .prepare<[], { id: number }>(
        "SELECT id FROM questions WHERE kind = 'meal_nutrition'",
      )
      .all(),
  );
  const label = {
    kcal: 600,
    protein_g: 30,
    carbs_g: 60,
    fat_g: 20,
    source: "Example label",
  };
  assert.equal((await answer(nutrition.id, label)).status, 200);
  fixture.setNow("2026-01-02T00:00:00.000Z");
  const eat = (mutation_id: string) => {
    const meal = first(meals());
    const input = {
      meal_id: meal.id,
      revision: meal.revision,
      action: "ate" as const,
      mutation_id,
    };
    return writeTransaction(database, (scope) =>
      eatOrderMeal(scope, admin.user, input, fixture.clock.now().toISOString()),
    );
  };
  eat("first");
  for (const delivered of [false, true]) {
    if (delivered)
      database
        .prepare("UPDATE orders SET delivered_at = ?")
        .run(fixture.clock.now().toISOString());
    const late = seed(parse(2, "processed"));
    run(late);
    database
      .prepare("UPDATE inbound_emails SET disposition = NULL WHERE id = ?")
      .run(late.id);
    run(late);
    await rejection(
      await answer(question(late).id, { action: "ignore" }, member),
      404,
      "not_found",
    );
    await rejection(
      await answer(question(late).id, { action: "accept" }),
      400,
      "invalid_answer",
    );
    assert.equal(question(late).status, "open");
    assert.equal(
      (await answer(question(late).id, { action: "ignore" })).status,
      200,
    );
    assert.equal(first(meals()).quantity, delivered ? 0 : 1);
    if (!delivered) eat("second");
  }
  assert.deepEqual(
    listMealCandidates(database, { user_id: admin.user.id }),
    [],
  );
  assert.deepEqual(
    listMealsOnHand(database, admin.user, fixture.clock.now().toISOString()),
    [],
  );
  database.prepare("UPDATE orders SET delivered_at = NULL").run();
  fixture.setNow("2026-01-01T00:00:00.000Z");
  const replacement = parse(1, "processed");
  replacement.meals[0].name = field("Garden Plate");
  run(seed(replacement));
  assert.deepEqual(
    meals().map((meal) => meal.quantity),
    [0, 1],
  );
  assert.equal(
    database.prepare("SELECT mutation_id FROM meal_actions").all().length,
    2,
  );
  replacement.meals[0].name = field("Garden Soup");
  run(seed(replacement));
  assert.deepEqual(
    meals().map((meal) => meal.name),
    ["Garden Bowl", "Garden Soup"],
  );
});

test("late acceptance creates once or commits a superseded answer after a collision", async (context) => {
  for (const collision of ["none", "due", "future"]) {
    const fixture = await setup(context);
    const { database, seed, run, question, answer } = fixture;
    fixture.setNow("2026-01-03T00:00:00.000Z");
    const lateList = parse(4, "processed");
    lateList.meals[0].chef = field(null);
    const late = seed(lateList);
    run(late);
    if (collision !== "none") {
      fixture.setNow("2026-01-01T00:00:00.000Z");
      run(seed(parse(2, "processed")));
    }
    if (collision === "due") fixture.setNow("2026-01-03T00:00:00.000Z");
    const response = await answer(question(late).id, { action: "accept" });
    const superseded = collision === "due";
    if (superseded) await rejection(response, 409, "order_superseded");
    else assert.equal(response.status, 200);
    assert.equal(question(late).status, "answered");
    assert.deepEqual(
      fixture.meals().map((meal) => [meal.quantity, meal.chef]),
      [[superseded ? 2 : 4, collision === "none" ? null : "Example chef"]],
    );
    assert.equal(
      selectReconcileEmail(database, late)?.applied_order_id,
      superseded ? null : fixture.order().id,
    );
  }
});

test("all sequences of up to three complete emails match precedence while not due", async (context) => {
  const { database, seed, run, admin, setNow } = await setup(context);
  const sequences: number[][] = [[]];
  for (let length = 1; length <= 3; length++)
    for (const prefix of sequences.filter(
      (sequence) => sequence.length === length - 1,
    ))
      for (const variant of [0, 1, 2]) sequences.push([...prefix, variant]);
  for (const sequence of sequences)
    for (let dueAfter = 0; dueAfter <= sequence.length; dueAfter++) {
      database.exec(
        "DELETE FROM questions; DELETE FROM order_meals; DELETE FROM orders; DELETE FROM inbound_emails",
      );
      for (const [index, variant] of sequence.entries()) {
        const due = index >= dueAfter;
        setNow(due ? "2026-01-02T00:00:00.000Z" : "2026-01-01T00:00:00.000Z");
        const processed = variant > 0,
          quantity = variant + 1;
        run(seed(parse(quantity, processed ? "processed" : "scheduling")));
      }
      const candidates = sequence.slice(0, dueAfter);
      const winner =
        candidates.filter((variant) => variant > 0).at(-1) ?? candidates.at(-1);
      const expected = winner === undefined ? [] : [winner + 1];
      assert.equal(
        database.prepare("SELECT id FROM orders").all().length,
        expected.length,
      );
      assert.deepEqual(
        listMealsOnHand(database, admin.user, "2026-01-02T00:00:00.000Z").map(
          (meal) => meal.quantity,
        ),
        expected,
      );
    }
  assert.equal(sequences.length, 40);
});
