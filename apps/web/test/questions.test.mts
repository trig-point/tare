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

const { QuestionList } = await import("../src/questions.tsx");
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

const render = (person: number, questions: unknown) =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(QuestionList, {
        person,
        questions: questions as never,
        failed: false,
        online: true,
      }),
    ),
  );

test("the questions list renders a badge count and a label form", async (context) => {
  const person = await withMeals(context);
  const markup = render(person, await readQuestions(signal));
  assert.match(markup, /Questions <span class="badge">2<\/span>/);
  assert.match(markup, /Enter label values for Example bowl/);
  assert.equal(markup.match(/Calories \(kcal\)/g)?.length, 2);
  assert.match(render(person, []), /No open questions/);
  assert.doesNotMatch(render(person, []), /badge/);
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
  assert.match(render(person, remaining), /class="badge">1</);
  const found = await findFood("Example bowl", signal);
  assert.deepEqual(
    found.foods.map((food) => [food.name, food.kcal, food.protein_g]),
    [["Example bowl", 600, 35]],
  );
});

test("a late list offers Accept only for a new order", () => {
  const late = (target: unknown) => ({
    id: 1,
    kind: "order_late_list",
    subject_ref: "1",
    prompt: "Example late list",
    answer_schema: { target },
    created_at: "2026-01-01T00:00:00.000Z",
  });
  const buttons = (target: unknown) =>
    render(1, [late(target)]).match(/>(Accept|Ignore)<\/button>/g);
  assert.deepEqual(buttons({ type: "existing", id: 1 }), [">Ignore</button>"]);
  assert.deepEqual(
    buttons({ type: "new", service: "example", delivery_date: "2026-02-10" }),
    [">Accept</button>", ">Ignore</button>"],
  );
});
