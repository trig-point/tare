import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { twoUsers } from "../../../packages/engine/test/support/two-users.ts";
import { actOnItem, readPlan } from "../src/plan-api.ts";
import { readToday } from "../src/today-api.ts";
import { test } from "./support.mts";
import "./tsx.mts";

const { SlotList } = await import("../src/slots.tsx");
const signal = new AbortController().signal;
const slotNames = ["Breakfast", "Lunch", "Dinner"];
const itemNames = ["Example oats", "Example salad", "Example stew"];

async function withPlan(context: Parameters<typeof twoUsers>[0]) {
  const setup = await twoUsers(context, "fallback");
  context.mock.method(globalThis, "fetch", setup.admin.request);
  const send = async (path: string, body: unknown) => {
    const response = await setup.admin.request(`/api/${path}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    assert.ok(response.ok);
    return response.json();
  };
  const { template } = await send("plan/templates", {
    action: "create",
    name: "Example day",
    slots: [
      { name: slotNames[0], start_minute: 0, end_minute: 600, share: 30 },
      { name: slotNames[1], start_minute: 600, end_minute: 1000, share: 30 },
      { name: slotNames[2], start_minute: 1000, end_minute: 1440, share: 40 },
    ],
  });
  const { day_type } = await send("plan/day-types", {
    action: "create",
    name: "Example type",
    template_id: template.id,
  });
  await send("plan/day-type", { day_type_id: day_type.id });
  await send("profile", {
    height_cm: 170,
    birth_date: "1990-01-01",
    sex: "female",
    activity_level: "moderate",
    goal_rate_kg_week: -0.25,
  });
  await send("weights", { client_id: "example-weight", weight_kg: 70 });
  const insert = setup.database.prepare(
    "INSERT INTO foods (user_id, name, kcal, protein_g, provenance) VALUES (?, ?, ?, 10, 'estimated')",
  );
  for (const [position, kcal] of [400, 200, 600].entries()) {
    const row = insert.run(setup.admin.user.id, itemNames[position], kcal);
    await send("plan/slot", { position, food_id: row.lastInsertRowid });
  }
  return setup.admin.user.id;
}

const render = (person: number, plan: unknown, online = true) =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(SlotList, {
        person,
        plan: plan as never,
        failed: false,
        online,
      }),
    ),
  );

test("the slot view renders each slot's remaining budget and planned item", async (context) => {
  const person = await withPlan(context);
  const plan = await readPlan(signal);
  const markup = render(person, plan);
  assert.deepEqual(markup.match(/(?<=<strong>)\w+/g), slotNames);
  assert.deepEqual(markup.match(/Example \w+(?=<\/span>)/g), itemNames);
  assert.equal(markup.match(/kcal left, [\d,.]+ g protein left/g)?.length, 3);
  assert.equal(markup.match(/>Ate 3\/4</g)?.length, 3);
  assert.match(render(person, undefined, false), /Unavailable offline/);
  const empty = {
    ...plan,
    slots: [],
    planned_items: [],
    budgets: { status: "no_day_type", target: null, slots: [] },
  };
  assert.match(render(person, empty), /No plan for today/);
  const [first, ...rest] = plan.budgets.slots;
  const kcal = {
    complete: false,
    known_subtotal: 100,
    budget: 500,
    remaining: null,
  };
  const partial = {
    ...plan,
    budgets: { ...plan.budgets, slots: [{ ...first, kcal }, ...rest] },
  };
  assert.match(render(person, partial), /400 kcal left, incomplete/);
});

test("ate, 3/4 and skip update today's totals and the slot view", async (context) => {
  const person = await withPlan(context);
  const items = (await readPlan(signal)).planned_items;
  const kcal = async () => (await readToday(signal)).totals.kcal.total;
  assert.equal(await kcal(), 0);
  const [oats, salad, stew] = items.toSorted(
    (left, right) => left.position - right.position,
  );
  assert.ok(oats && salad && stew);
  await actOnItem(oats, "ate");
  assert.equal(await kcal(), 400);
  await actOnItem(salad, "ate_three_quarters");
  assert.equal(await kcal(), 550);
  await actOnItem(stew, "skip");
  assert.equal(await kcal(), 550);
  const plan = await readPlan(signal);
  const breakfast = plan.budgets.slots.find((slot) => slot.position === 0);
  assert.ok(breakfast?.kcal.remaining && breakfast.kcal.budget);
  assert.equal(breakfast.kcal.budget - breakfast.kcal.remaining, 400);
  const markup = render(person, plan);
  assert.match(
    markup,
    new RegExp(
      `>Breakfast</strong><span>${breakfast.kcal.remaining} kcal left`,
    ),
  );
  assert.equal(markup.match(/>Eaten</g)?.length, 2);
  assert.match(markup, />Skipped</);
  assert.doesNotMatch(markup, />Ate</);
});
