import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { writeTransaction } from "../../../packages/engine/src/db.ts";
import { mealNutritionKinds } from "../../../packages/engine/src/meal-nutrition/index.ts";
import { createOrder } from "../../../packages/engine/src/orders/index.ts";
import { twoUsers } from "../../../packages/engine/test/support/two-users.ts";
import { findFood } from "../src/food-api.ts";
import {
  answerQuestion,
  blankLabel,
  labelAnswer,
  readQuestions,
} from "../src/questions-api.ts";
import { test } from "./support.mts";
import "./tsx.mts";

const { QuestionList, QuestionDeck, deckPosition } = await import(
  "../src/questions.tsx"
);
const signal = new AbortController().signal;

async function withMeals(context: Parameters<typeof twoUsers>[0]) {
  const setup = await twoUsers(context, "fallback");
  context.mock.method(globalThis, "fetch", setup.admin.request);
  writeTransaction(setup.database, (scope) =>
    createOrder(
      scope,
      setup.admin.user,
      {
        service: "Example meals",
        delivery_date: "2026-02-10",
        status: "scheduled",
        meals: [
          { name: "Example bowl", chef: null, quantity: 1 },
          { name: "Example curry", chef: null, quantity: 1 },
        ],
      },
      mealNutritionKinds,
      "2026-01-01T00:00:00.000Z",
    ),
  );
  return setup.admin.user.id;
}

const withClient = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client: new QueryClient() }, element),
  );
const render = (person: number, questions: unknown) =>
  withClient(
    createElement(QuestionList, {
      person,
      questions: questions as never,
      failed: false,
      online: true,
    }),
  );
const question = (
  id: number,
  kind: string,
  answer_schema: Record<string, unknown> = {},
) => ({
  id,
  kind,
  subject_ref: String(id),
  prompt: `Example ${kind}`,
  answer_schema,
  created_at: "2026-01-01T00:00:00.000Z",
});
const deck = (questions: ReturnType<typeof question>[], start: number) =>
  withClient(
    createElement(QuestionDeck, {
      person: 1,
      questions,
      online: true,
      start,
      onClose: () => {},
    }),
  );

test("the questions page shows the waiting count or an empty state", async (context) => {
  const person = await withMeals(context);
  const markup = render(person, await readQuestions(signal));
  assert.match(markup, />2 waiting</);
  assert.match(markup, /Enter label values for Example bowl/);
  assert.match(render(person, []), /No open questions/);
  assert.doesNotMatch(render(person, []), /waiting/);
});

test("the nutrition form submits, closes the question and adds the food", async (context) => {
  const person = await withMeals(context);
  const [bowl] = (await readQuestions(signal)).filter((question) =>
    question.prompt.includes("Example bowl"),
  );
  assert.ok(bowl);
  await answerQuestion(
    bowl.id,
    labelAnswer({
      ...blankLabel,
      kcal: "600",
      protein_g: " 35 ",
      carbs_g: "60",
      fat_g: "20",
      source: "Example package",
    }),
  );
  const remaining = await readQuestions(signal);
  assert.deepEqual(
    remaining.map((question) => question.prompt),
    ["Enter label values for Example curry (1 whole meal)."],
  );
  assert.match(render(person, remaining), />1 waiting</);
  const found = await findFood("Example bowl", signal);
  assert.deepEqual(
    found.foods.map((food) => [food.name, food.kcal, food.protein_g]),
    [["Example bowl", 600, 35]],
  );
});

test("the sheet shows one question at a time with its answer controls and Skip", () => {
  const questions = [
    question(1, "meal_nutrition"),
    question(2, "held_order_email"),
    question(3, "order_late_list", { target: { type: "existing", id: 1 } }),
    question(4, "order_late_list", { target: { type: "new" } }),
    question(5, "order_delivery_date"),
    question(6, "order_review", { mode: "advisory" }),
    question(7, "order_review", { mode: "blocking" }),
  ];
  const controls = (start: number) =>
    deck(questions, start).match(
      /type="(date|number)"|>(Save and next|Process email|Discard|Accept|Ignore|Looks right|Answer this one with your agent\.)</g,
    );
  const cases: [number, string[]][] = [
    [1, [...Array(5).fill('type="number"'), ">Save and next<"]],
    [2, [">Process email<", ">Discard<"]],
    [3, [">Ignore<"]],
    [4, [">Accept<", ">Ignore<"]],
    [5, ['type="date"', ">Save and next<"]],
    [6, [">Looks right<"]],
    [7, [">Answer this one with your agent.<"]],
  ];
  for (const [start, expected] of cases) {
    assert.deepEqual(controls(start), expected, `question ${start}`);
    const markup = deck(questions, start);
    assert.match(markup, new RegExp(`>${start} of 7<`));
    assert.equal(markup.match(/<article/g)?.length, 1);
    assert.match(markup, />Skip for now</);
    assert.doesNotMatch(markup, /textarea|JSON/);
  }
});

test("the deck moves past answered questions and ends after the last", () => {
  const order = [10, 11, 12];
  assert.equal(deckPosition(order, new Set([10, 11, 12]), 0), 0);
  assert.equal(deckPosition(order, new Set([12]), 0), 2);
  assert.equal(deckPosition(order, new Set([10, 11]), 2), 3);
  assert.equal(deckPosition(order, new Set(), -1), 3);
  assert.equal(deckPosition([], new Set([1]), 0), 0);
  assert.match(deck([], 0), />All caught up</);
});
