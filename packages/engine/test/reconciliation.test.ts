import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { Config } from "../src/config.ts";
import { writeTransaction } from "../src/db.ts";
import { createOrderEmailParseJob } from "../src/inbound/job.ts";
import { createOrderQuestionKinds } from "../src/inbound/questions.ts";
import { reconcileEmail } from "../src/inbound/reconcile.ts";
import { eatOrderMeal } from "../src/orders/eat.ts";
import { listMealsOnHand } from "../src/orders/index.ts";
import { listMealCandidates } from "../src/queries/orders/list-meal-candidates.ts";
import { listReconcileMeals } from "../src/queries/orders/list-reconcile-meals.ts";
import { selectDeliveryOrder } from "../src/queries/orders/select-delivery-order.ts";
import { selectPerson } from "../src/queries/select-person.ts";
import { selectQueuedInboundEmail } from "../src/queries/select-queued-inbound-email.ts";
import { selectReconcileEmail } from "../src/queries/select-reconcile-email.ts";
import { updateInboundParse } from "../src/queries/update-inbound-parse.ts";
import { createQuestion } from "../src/questions/kinds.ts";
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
const emailServices = {
  kit: { senders: ["orders@kit.example.com"], dkim_domains: [] },
};
async function setup(
  context: TestContext,
  services: Config["orderEmailServices"] = emailServices,
) {
  const fixture = await twoUsers(context, "fallback");
  const { database, admin } = fixture;
  let now = "2026-01-01T00:00:00.000Z",
    sequence = 0;
  const clock = { now: () => new Date(now) };
  const kinds = createOrderQuestionKinds({ clock, services });
  const job = createOrderEmailParseJob({
    database,
    clock,
    model: null,
    questionKinds: kinds,
    services,
  });
  const seed = (
    result: unknown = parse(),
    person = admin,
    state = "parsed",
  ) => ({
    user_id: person.user.id,
    id: Number(
      database
        .prepare(
          "INSERT INTO inbound_emails (user_id, service, mark, dedupe_key, raw, subject_attached, parse_state, parse_result, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
        )
        .run(
          person.user.id,
          state === "held" ? null : "kit",
          state === "held" ? "unverified" : "sender_matched",
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
      reconcileEmail(
        scope,
        email,
        selectPerson(database, { id: person.user.id }) ?? person.user,
        now,
        { questionKinds: kinds, services },
        "job",
      ),
    );
  const order = (date = "2026-01-02") => {
    const row = selectDeliveryOrder(database, {
      user_id: admin.user.id,
      service: "kit",
      delivery_date: date,
    });
    assert.ok(row);
    return row;
  };
  const meals = (date = "2026-01-02") =>
    listReconcileMeals(database, {
      user_id: admin.user.id,
      order_id: order(date).id,
    });
  const question = (
    email: ReturnType<typeof seed>,
    kind = "order_late_list",
  ) => {
    const rows = database
      .prepare<
        [string, string],
        { id: number; status: string; answer_schema: string }
      >(
        "SELECT id, status, answer_schema FROM questions WHERE subject_ref = ? AND kind = ? ORDER BY id DESC",
      )
      .all(String(email.id), kind);
    assert.ok(rows.filter((row) => row.status === "open").length <= 1);
    return first(rows);
  };
  const answer = (id: number, value: unknown, person = admin) =>
    person.request("/api/questions/answer", {
      method: "POST",
      body: JSON.stringify({ id, answer: value }),
    });
  const answerOk = async (id: number, value: unknown) =>
    assert.equal((await answer(id, value)).status, 200);
  const release = async (email: ReturnType<typeof seed>) => {
    const held = createQuestion(
      database,
      {
        userId: email.user_id,
        kind: "held_order_email",
        subjectRef: String(email.id),
        prompt: "Confirm the email.",
      },
      clock,
      kinds,
    );
    await answerOk(held.id, { release: true });
  };
  const setNow = (value: string) => {
    now = value;
    fixture.setNow(value);
  };
  return {
    ...fixture,
    clock,
    kinds,
    job,
    seed,
    run,
    order,
    meals,
    question,
    answer,
    answerOk,
    release,
    setNow,
  };
}

test("chef carry-over, merged identities and ownership", async (context) => {
  const { database, member, seed, run, meals, setNow, question } =
    await setup(context);
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
  const twoChefs = parse(1, "processed");
  twoChefs.meals.push({
    ...twoChefs.meals[0],
    source_index: 1,
    chef: field("Other chef"),
  });
  run(seed(twoChefs));
  setNow("2026-01-02T00:00:00.000Z");
  const late = seed(processed);
  run(late);
  assert.equal(question(late).status, "open");
});

test("pickup questions rows once, reconciles failed manual answers and validates persisted data and mapper offsets", async (context) => {
  const fixture = await setup(context);
  const { database, admin, seed, job } = fixture;
  const pending = [
    parse(null),
    parse(2, "processed", null),
    { ...parse(), meals: [] },
    { ...parse(), uncertain: ["delivery_date"] },
    { ...parse(), dropped: ["meals[0].chef"] },
    { ...parse(), kind: field(null) },
  ].map((result) => seed(result));
  const deferred = ["held", "no_model", "failed"].map((state) =>
    seed({ status: state }, admin, state),
  );
  const malformed = seed({ status: "parsed" });
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
  for (let pass = 0; pass < 2; pass++)
    await assert.rejects(
      job.run({ signal: new AbortController().signal }),
      /Order email parse failed/,
    );
  assert.equal(
    selectReconcileEmail(database, complete)?.disposition,
    "reconciled",
  );
  for (const email of pending)
    assert.ok(selectReconcileEmail(database, email)?.disposition);
  for (const [index, email] of deferred.entries())
    assert.equal(
      selectReconcileEmail(database, email)?.disposition,
      index === 0 ? null : "questioned",
    );
  assert.equal(
    database.prepare("SELECT id FROM questions WHERE kind LIKE 'order_%'").all()
      .length,
    pending.length + 2,
  );
  assert.throws(() => fixture.run(malformed));
  assert.equal(selectReconcileEmail(database, malformed)?.disposition, null);
  assert.equal(first(fixture.meals()).revision, 2);
  const failedEmail = first(deferred.slice(2));
  assert.equal(
    selectReconcileEmail(database, failedEmail)?.parse_state,
    "failed",
  );
  await fixture.answerOk(
    fixture.question(failedEmail, "order_manual_entry").id,
    {
      service: " KIT ",
      kind: "processed",
      delivery_date: "2026-01-02",
      meals: [{ name: "Garden Bowl", quantity: 4 }],
    },
  );
  assert.equal(first(fixture.meals()).quantity, 4);
});

test("day-start changes and late lists preserve eaten stock; zero meals are hidden", async (context) => {
  const fixture = await setup(context);
  const { database, admin, member, seed, run, meals, answer, question } =
    fixture;
  const scheduled = parse();
  scheduled.dropped = ["meals[1]"];
  const originalEmail = seed(scheduled);
  run(originalEmail);
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
  database.prepare("UPDATE users SET day_start_hour = 6").run();
  await rejection(
    await answer(question(originalEmail, "order_review").id, {
      corrections: { meals: [{ source_index: 0, quantity: 2 }] },
    }),
    409,
    "order_due",
  );
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
    if (!delivered) {
      database.prepare("UPDATE users SET day_start_hour = 0").run();
      eat("second");
    }
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
  const replacement = parse(1, "processed", "2026-01-03");
  replacement.meals[0].name = field("Garden Plate");
  run(seed(replacement));
  assert.deepEqual(
    meals().map((meal) => meal.quantity),
    [0],
  );
  assert.equal(
    database.prepare("SELECT mutation_id FROM meal_actions").all().length,
    2,
  );
  const stamp = fixture.clock.now().toISOString();
  database
    .prepare(
      "INSERT INTO planned_items (user_id, day, order_meal_id, created_at, updated_at) VALUES (?, '2026-01-03', ?, ?, ?)",
    )
    .run(admin.user.id, first(meals("2026-01-03")).id, stamp, stamp);
  for (const name of ["Garden Soup", "Garden Rice"]) {
    replacement.meals[0].name = field(name);
    run(seed(replacement));
  }
  assert.deepEqual(
    meals("2026-01-03").map((meal) => [meal.name, meal.quantity]),
    [
      ["Garden Plate", 0],
      ["Garden Rice", 1],
    ],
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

test("all sequences of up to three emails, including released and manually entered lists, match precedence while not due", async (context) => {
  const fixture = await setup(context);
  const { answerOk, database, seed, run, admin, setNow, order, question } =
    fixture;
  const reset = () =>
    database.exec(
      "DELETE FROM questions; DELETE FROM order_meals; DELETE FROM orders; DELETE FROM inbound_emails",
    );
  const onHand = () =>
    listMealsOnHand(database, admin.user, "2026-01-02T00:00:00.000Z").map(
      (meal) => meal.quantity,
    );
  const sequences: number[][] = [[]];
  for (let length = 1; length <= 3; length++)
    for (const prefix of sequences.filter(
      (sequence) => sequence.length === length - 1,
    ))
      for (const variant of [0, 1, 2, 3, 4, 5])
        sequences.push([...prefix, variant]);
  for (const sequence of sequences)
    for (let dueAfter = 0; dueAfter <= sequence.length; dueAfter++) {
      reset();
      const emails: { processed: boolean; quantity: number; id: number }[] = [];
      for (const [index, variant] of sequence.entries()) {
        setNow(
          index >= dueAfter
            ? "2026-01-02T00:00:00.000Z"
            : "2026-01-01T00:00:00.000Z",
        );
        const processed = variant > 0,
          quantity = variant + 1 + 3 * index;
        const result = parse(
          variant === 3 ? null : quantity,
          processed ? "processed" : "scheduling",
          variant === 2 ? null : "2026-01-02",
        );
        const email = seed(
          variant === 5 ? { status: "no_model" } : result,
          admin,
          variant === 4 ? "held" : variant === 5 ? "no_model" : "parsed",
        );
        if (variant === 4) {
          await fixture.release(email);
          database
            .prepare(
              "UPDATE inbound_emails SET parse_state = 'parsed' WHERE id = ?",
            )
            .run(email.id);
        }
        run(email);
        if (variant === 5)
          await answerOk(question(email, "order_manual_entry").id, {
            service: "kit",
            kind: "processed",
            delivery_date: "2026-01-02",
            meals: [{ name: "Garden Bowl", chef: "Example chef", quantity }],
          });
        if (variant === 2 && (index === 0 || index >= dueAfter))
          await answerOk(question(email, "order_delivery_date").id, {
            delivery_date: "2026-01-02",
          });
        if (variant === 3 && (index < dueAfter || dueAfter === 0))
          await answerOk(question(email, "order_review").id, {
            meals: [{ source_index: 0, quantity }],
          });
        emails.push({ processed, quantity, id: email.id });
      }
      const candidates = emails.slice(0, dueAfter);
      const winner =
        candidates.filter((email) => email.processed).at(-1) ??
        candidates.at(-1);
      assert.deepEqual(onHand(), winner ? [winner.quantity] : []);
      assert.equal(
        database.prepare("SELECT id FROM orders").all().length,
        winner ? 1 : 0,
      );
      if (winner)
        assert.deepEqual(
          [order().status, order().applied_email_id],
          [winner.processed ? "processed" : "scheduled", winner.id],
        );
    }
  assert.equal(sequences.length, 259);
  reset();
  setNow("2026-01-01T00:00:00.000Z");
  const older = seed(parse(null));
  run(older);
  setNow("2026-01-01T00:00:00.001Z");
  run(seed(parse(6)));
  await answerOk(question(older, "order_review").id, {
    meals: [{ source_index: 0, quantity: 5 }],
  });
  assert.deepEqual(onHand(), [6]);
});

test("blocking answers preserve partial fixes and open a successor", async (context) => {
  const { answerOk, database, seed, run, question, answer, meals, member } =
    await setup(context);
  const result = parse(null);
  result.dropped = ["delivery_date"];
  result.delivery_date = field(null);
  const email = seed(result);
  run(email);
  const initial = question(email, "order_review");
  await rejection(await answer(initial.id, {}, member), 404, "not_found");
  for (const invalid of [{}, { delivery_date: "invalid" }, { confirm: true }])
    await rejection(await answer(initial.id, invalid), 400, "invalid_answer");
  await answerOk(initial.id, { delivery_date: "2026-01-02" });
  const next = question(email, "order_review");
  assert.notEqual(next.id, initial.id);
  assert.deepEqual(
    database
      .prepare(
        "SELECT status FROM questions WHERE kind = 'order_review' ORDER BY id",
      )
      .all(),
    [{ status: "answered" }, { status: "open" }],
  );
  const saved = selectReconcileEmail(database, email);
  assert.equal(saved?.disposition, "questioned");
  assert.equal(
    JSON.parse(saved?.manual_result ?? "null").partial.delivery_date,
    "2026-01-02",
  );
  await rejection(
    await answer(next.id, { meals: [{ source_index: 8, quantity: 3 }] }),
    400,
    "invalid_answer",
  );
  assert.equal(question(email, "order_review").status, "open");
  await answerOk(next.id, { meals: [{ source_index: 0, quantity: 3 }] });
  assert.equal(first(meals()).quantity, 3);
  assert.equal(
    selectReconcileEmail(database, email)?.disposition,
    "reconciled",
  );
  assert.equal(
    "partial" in
      JSON.parse(
        selectReconcileEmail(database, email)?.manual_result ?? "null",
      ),
    false,
  );
});

test("blocking reviews accept full meal names and original-index fixes", async (context) => {
  const { answerOk, seed, run, question, meals } = await setup(context);
  for (const empty of [true, false]) {
    const result = parse(2, "processed");
    result.meals[0].source_index = 2;
    result.uncertain = ["kind", "meals[2].quantity"];
    if (empty) {
      result.meals.splice(0);
      result.dropped = ["meals[0]"];
    }
    const email = seed(result);
    run(email);
    await answerOk(question(email, "order_review").id, { kind: "processed" });
    const fix = empty
      ? { meals: [{ name: "Garden Bowl", chef: "Example chef", quantity: 4 }] }
      : { meals: [{ source_index: 2, quantity: 4 }] };
    await answerOk(question(email, "order_review").id, fix);
    assert.equal(first(meals()).quantity, 4);
  }
});

test("advisory answers confirm, correct names, preserve revisions and commit supersession", async (context) => {
  for (const mode of ["confirm", "same", "name", "superseded", "due"]) {
    const { answerOk, seed, run, question, answer, meals, setNow } =
      await setup(context);
    const result = parse(2, "processed");
    result.dropped = ["meals[1]"];
    if (mode === "same") {
      run(seed());
      result.delivery_date = field(null);
    }
    const email = seed(result);
    run(email);
    const review = question(email, "order_review");
    assert.equal(JSON.parse(review.answer_schema).mode, "advisory");
    const before = meals();
    const corrections = {
      meals: [
        {
          name: mode === "name" ? "Garden Plate" : "Garden Bowl",
          chef: "Example chef",
          quantity: 2,
        },
      ],
    };
    if (mode === "name")
      corrections.meals.push({
        name: "Garden Soup",
        chef: "Example chef",
        quantity: 1,
      });
    await rejection(
      await answer(review.id, { corrections: { delivery_date: "2026-01-03" } }),
      400,
      "invalid_answer",
    );
    if (mode === "superseded") run(seed(parse(7, "processed")));
    if (mode === "due") setNow("2026-01-02T00:00:00.000Z");
    const response = await answer(
      review.id,
      mode === "confirm" ? { confirm: true } : { corrections },
    );
    if (mode === "due") {
      await rejection(response, 409, "order_due");
      assert.equal(question(email, "order_review").status, "open");
      await answerOk(review.id, { confirm: true });
    } else if (mode === "superseded") {
      await rejection(response, 409, "order_superseded");
      assert.equal(first(meals()).quantity, 7);
    } else if (mode === "name") {
      assert.equal(response.status, 200);
      assert.deepEqual(
        meals().map((meal) => meal.name),
        ["Garden Plate", "Garden Soup"],
      );
    } else assert.equal(response.status, 200);
    assert.equal(question(email, "order_review").status, "answered");
    if (mode !== "name" && mode !== "superseded")
      assert.deepEqual(meals(), before);
  }
});

test("dateless lists attach by receipt day, reuse processed deliveries and keep ownership", async (context) => {
  const {
    answerOk,
    database,
    admin,
    member,
    seed,
    run,
    meals,
    setNow,
    question,
    order,
  } = await setup(context);
  database.prepare("UPDATE users SET day_start_hour = 4").run();
  run(seed());
  run(seed(parse(1, "scheduling", "2026-01-03")));
  const dateless = parse(3, "processed", null);
  dateless.meals[0].chef = field(null);
  setNow("2026-01-01T22:29:00.000Z");
  for (const quantity of [3, 4]) {
    dateless.meals[0].quantity = field(quantity);
    run(seed(dateless));
    assert.deepEqual(
      meals().map((meal) => [meal.quantity, meal.chef]),
      [[quantity, "Example chef"]],
    );
  }
  const foreign = seed(dateless, member);
  run(foreign, member);
  assert.equal(question(foreign, "order_delivery_date").status, "open");
  setNow("2026-01-01T22:30:00.000Z");
  run(seed(dateless));
  assert.equal(first(meals("2026-01-03")).quantity, 4);
  database
    .prepare("UPDATE orders SET delivered_at = ? WHERE id = ?")
    .run("2026-01-01T00:00:00.000Z", order().id);
  setNow("2026-01-01T22:29:00.000Z");
  const early = seed(dateless);
  run(early);
  assert.equal(question(early).status, "open");
  assert.equal(first(meals("2026-01-03")).revision, 2);
  const scheduling = seed(parse(1, "scheduling", null));
  run(scheduling);
  await answerOk(question(scheduling, "order_delivery_date").id, {
    delivery_date: "2026-01-04",
  });
  assert.equal(
    database
      .prepare("SELECT id FROM orders WHERE user_id = ?")
      .all(admin.user.id).length,
    3,
  );
});

test("ambiguous chefs require a blocking answer before replacement", async (context) => {
  const { answerOk, seed, run, meals, question } = await setup(context);
  const scheduled = parse();
  scheduled.meals.push({
    ...parsedMeal(1),
    source_index: 1,
    chef: field("Other chef"),
  });
  run(seed(scheduled));
  const processed = parse(3, "processed");
  processed.meals[0].chef = field(null);
  const email = seed(processed);
  run(email);
  assert.equal(meals().length, 2);
  await answerOk(question(email, "order_review").id, {
    meals: [{ source_index: 0, chef: "Other chef" }],
  });
  assert.deepEqual(
    meals().map((meal) => [meal.chef, meal.quantity]),
    [["Other chef", 3]],
  );
});

test("held release reaches parsed, model-free and failed outcomes and recovers after interruption", async (context) => {
  const fixture = await setup(context);
  const { database, admin, seed, clock, question, release, job } = fixture;
  for (const outcome of ["parsed", "no_model", "failed"]) {
    const email = seed(null, admin, "held");
    await release(email);
    const released = selectReconcileEmail(database, email);
    assert.deepEqual(
      [released?.parse_state, released?.disposition, released?.released_at],
      ["queued", null, clock.now().toISOString()],
    );
    writeTransaction(database, () =>
      updateInboundParse(
        database,
        {
          parse_state: outcome,
          parse_result: JSON.stringify(
            outcome === "parsed" ? parse() : { status: outcome },
          ),
          reason_class: null,
          now: clock.now().toISOString(),
        },
        email,
      ),
    );
    assert.equal(selectReconcileEmail(database, email)?.disposition, null);
    await job.run({ signal: new AbortController().signal });
    const manual = outcome === "no_model" || outcome === "failed";
    assert.equal(
      selectReconcileEmail(database, email)?.disposition,
      manual ? "questioned" : "reconciled",
    );
    if (manual)
      assert.equal(question(email, "order_manual_entry").status, "open");
  }
  assert.deepEqual(
    database.prepare("SELECT name, quantity FROM order_meals").all(),
    [{ name: "Garden Bowl", quantity: 2 }],
  );
});

test("released service matching and human service identities work with empty configuration", async (context) => {
  for (const configured of [false, true]) {
    const services: Config["orderEmailServices"] = configured
      ? { kit: { senders: ["orders@kit.example.com"], dkim_domains: [] } }
      : {};
    const { database, admin, seed, run, question, answerOk, release } =
      await setup(context, services);
    for (const service of ["  KIT  ", "Other kit", "uncertain"]) {
      const result = parse();
      result.service = field(service === "uncertain" ? "kit" : service);
      if (service === "uncertain") result.uncertain = ["service"];
      const email = seed(result, admin, "held");
      await release(email);
      database
        .prepare(
          "UPDATE inbound_emails SET parse_state = 'parsed' WHERE id = ?",
        )
        .run(email.id);
      run(email);
      if (!configured || service !== "  KIT  ") {
        assert.equal(
          selectReconcileEmail(database, email)?.disposition,
          "questioned",
        );
        await answerOk(question(email, "order_review").id, {
          service: service === "Other kit" ? "  Meal Straße  " : " KIT ",
        });
      }
      assert.equal(
        selectReconcileEmail(database, email)?.disposition,
        "reconciled",
      );
    }
    assert.deepEqual(
      database.prepare("SELECT service FROM orders ORDER BY service").all(),
      [{ service: "kit" }, { service: "meal strasse" }],
    );
  }
});
