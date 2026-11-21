import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pantryHarness } from "../../../packages/engine/test/support/pantry-fake.ts";
import { ApiError } from "../src/api.ts";
import {
  type Pantry,
  type PantryProducts,
  readLink,
  readPantry,
  readProducts,
  readRequests,
  reconcile,
  refreshPantry,
  type ShoppingList,
  type StockRequests,
  saveBinding,
} from "../src/pantry-api.ts";
import { test } from "./support.mts";
import "./tsx.mts";

const { FoodResults, PantryView } = await import("../src/pantry.tsx");

const ready: Pantry = {
  state: "ready",
  generation: 1,
  last_success_at: "2026-01-01T00:00:00.000Z",
  stale: false,
  error: null,
  products: [
    {
      product_id: 7,
      name: "Synthetic beans",
      amount: 4,
      stock_unit: { id: 2, name: "can", name_plural: null },
    },
  ],
  bindings: [],
  requested: [],
};
const render = (
  pantry: Pantry,
  requests?: StockRequests,
  catalog?: PantryProducts,
) =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(PantryView, {
        person: 1,
        online: true,
        pantry,
        failed: false,
        requests,
        requestsFailed: false,
        link: "https://grocy.example.com/",
        catalog,
      }),
    ),
  );
const text = (markup: string) =>
  markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const empty = {
  ...ready,
  generation: null,
  last_success_at: null,
  products: [],
};

const request = (unit: number) => ({
  request_id: `request-${unit}`,
  state: "uncertain" as const,
  current_number: 1,
  created_at: "2026-01-01T00:00:00.000Z",
  resolved_at: null,
  frozen: { product_id: 7, stock_unit_id: unit, quantity: 2 },
  reference: { kind: "food", id: 1 },
  intake: { name: `Example meal ${unit}` },
  edit_notice: null,
  retry: { eligible: false, not_before: null },
});

test("a disabled pantry says so instead of showing empty stock", () => {
  const markup = render({ ...empty, state: "disabled", stale: true });
  assert.match(markup, /Pantry not set up/);
  assert.doesNotMatch(markup, /Stock from Grocy/);
  assert.doesNotMatch(markup, /No stock|>Refresh</);
});

test("a reset-required pantry offers a reset and no bindings", () => {
  const markup = render(
    { ...empty, state: "reset_required", generation: 1 },
    { state: "reset_required", unresolved: [request(2)], history: [] },
  );
  assert.match(markup, /Pantry connection needs a reset/);
  assert.match(markup, />Reset connection</);
  assert.match(text(markup), / Requests 1 /);
  assert.doesNotMatch(markup, /Bind food/);
});

test("a never-refreshed pantry is not shown as empty", () => {
  const markup = render({
    ...empty,
    state: "never_refreshed",
    generation: 1,
    stale: true,
  });
  assert.match(markup, /Pantry not refreshed yet/);
  assert.match(markup, />Refresh</);
  assert.doesNotMatch(markup, /No stock/);
});

test("stale stock stays listed with its update time", () => {
  const markup = render({ ...ready, stale: true });
  assert.match(markup, /Stock may be out of date/);
  assert.match(text(markup), /Synthetic beans 4 can/);
  assert.match(markup, /Updated <time dateTime="2026-01-01T00:00:00.000Z">/);
  assert.match(markup, /href="https:\/\/grocy.example.com\/"/);
});

test("a failed refresh keeps the last stock and shows the failure", () => {
  const markup = render({
    ...ready,
    stale: true,
    error: { reason: "timeout" },
  });
  assert.match(markup, /Refresh failed/);
  assert.match(markup, /Synthetic beans/);
  assert.doesNotMatch(markup, /No stock/);
});

test("a request frozen in another unit keeps its own unit", () => {
  const markup = render(ready, {
    state: "ready",
    unresolved: [request(2), request(3)],
    history: [
      { ...request(4), state: "delivered", edit_notice: { servings: 2 } },
    ],
  });
  assert.match(text(markup), /Example meal 2 Uncertain 2 can /);
  assert.match(text(markup), /Example meal 3 Uncertain 2 unit 3 /);
  assert.match(
    text(markup),
    /Recent requests Example meal 4 2 unit 4 \/ Delivered Edited to 2 servings/,
  );
});

test("abandoning a pending request moves it to history and keeps its error code", async (context) => {
  const harness = await pantryHarness(context);
  context.mock.method(globalThis, "fetch", harness.admin.request);
  harness.bind("food", 1, 7);
  harness.request(1, "pending", 2);
  const open = await readRequests();
  const [request] = open.unresolved;
  assert.ok(request);
  assert.match(
    text(render(await readPantry(), open)),
    /Food 1 Pending 2 unit 2 [\w ,:]+ Abandon /,
  );
  const decision = {
    request_id: request.request_id,
    attempt_number: request.current_number,
    mutation_id: "example-decision",
    decision: "abandoned" as const,
  };
  assert.deepEqual(await reconcile(decision), { resulting_state: "abandoned" });
  assert.deepEqual(await reconcile(decision), { resulting_state: "abandoned" });
  const after = await readRequests();
  assert.deepEqual(after.unresolved, []);
  assert.deepEqual(
    after.history.map((entry) => entry.state),
    ["abandoned"],
  );
  assert.match(
    text(render(await readPantry(), after)),
    /Recent requests Food 1 2 unit 2 \/ Abandoned/,
  );
  await assert.rejects(
    reconcile({ ...decision, mutation_id: "example-second" }),
    (error) =>
      error instanceof ApiError &&
      error.code === "pantry_request_not_actionable",
  );
  assert.equal(await readLink(), null);
  context.mock.method(globalThis, "fetch", harness.member.request);
  await assert.rejects(
    readLink(),
    (error) => error instanceof ApiError && error.status === 403,
  );
});

test("an empty product and a broken binding are flagged on the stock tab", () => {
  const markup = text(
    render({
      ...ready,
      products: [
        {
          ...ready.products[0],
          amount: 0,
          stock_unit: { id: 2, name: "can", name_plural: "cans" },
        },
      ] as Pantry["products"],
      bindings: [
        {
          reference_kind: "food",
          reference_id: 1,
          name: "Example stew",
          product_id: 9,
          quantity_per_serving: 1,
          status: "product_missing",
        },
      ],
    }),
  );
  assert.match(markup, /Synthetic beans 0 cans Out of stock/);
  assert.match(
    markup,
    /1 binding needs attention Example stew \/ Product missing View/,
  );
});

test("a binding row names its food", () => {
  const binding = {
    reference_kind: "food" as "food" | "source_food",
    product_id: 7,
    quantity_per_serving: 0.5,
    status: "valid",
  };
  const markup = render({
    ...ready,
    bindings: [
      { ...binding, reference_id: 1, name: "Jasmine rice (Example), dry" },
      {
        ...binding,
        reference_kind: "source_food",
        reference_id: 2,
        name: null,
      },
      {
        ...binding,
        reference_id: 3,
        name: "Example soup",
        status: "unit_mismatch",
      },
    ],
  });
  assert.match(
    text(markup),
    /0.5 can per serving of Jasmine rice \(Example\), dry/,
  );
  assert.match(text(markup), /0.5 can per serving of source food 2/);
  assert.match(text(markup), / 0.5 per serving of Example soup Unit mismatch/);
});

const results = (foods: Parameters<typeof FoodResults>[0]["foods"]) =>
  renderToStaticMarkup(createElement(FoodResults, { foods, choose: () => {} }));

test("food search results offer each match by name", () => {
  const markup = results([
    {
      reference: { kind: "food", id: 1 },
      source: null,
      name: "Jasmine rice (Example), dry",
      brand: null,
      serving: "45 g",
    },
    {
      reference: { kind: "source_food", id: 1 },
      source: "off",
      name: "Example rice",
      brand: "Example brand",
      serving: null,
    },
  ]);
  assert.match(text(markup), /Jasmine rice \(Example\), dry 45 g Choose/);
  assert.match(text(markup), /Example rice Example brand · Open Food Facts/);
  assert.match(markup, /aria-label="Choose Jasmine rice \(Example\), dry"/);
});

test("a food search with no matches says so", () => {
  assert.match(results([]), /^<p[^>]*>No foods found<\/p>$/);
});

test("the product picker lists an out-of-stock product and binds it", async (context) => {
  const harness = await pantryHarness(context);
  context.mock.method(globalThis, "fetch", harness.admin.request);
  harness.database
    .prepare(
      "INSERT INTO foods (user_id, name, provenance) VALUES (?, ?, 'label')",
    )
    .run(harness.admin.user.id, "Example soup");
  const pantry = await refreshPantry();
  const catalog = await readProducts();
  assert.match(
    render(pantry, undefined, catalog),
    /<option value="8">Synthetic item 8 \(0 can\)<\/option>/,
  );
  const bound = await saveBinding({
    reference_kind: "food",
    reference_id: 1,
    product_id: 8,
    stock_unit_id: 2,
    quantity_per_serving: 1,
    expected_generation: Number(pantry.generation),
  });
  assert.deepEqual(
    bound.bindings.map((binding) => binding.product_id),
    [8],
  );
  context.mock.method(globalThis, "fetch", harness.member.request);
  await assert.rejects(
    readProducts(),
    (error) => error instanceof ApiError && error.status === 403,
  );
});

test("an unavailable Grocy says so and keeps stocked products", () => {
  const markup = render(ready, undefined, {
    state: "unavailable",
    generation: null,
    products: [],
  });
  assert.match(markup, /Grocy unavailable/);
  assert.match(markup, /<option value="7">Synthetic beans \(4 can\)/);
});

test("a product list from before a reset is not offered", () => {
  const markup = render(ready, undefined, {
    state: "ready",
    generation: 2,
    products: [
      {
        product_id: 8,
        name: "Old item",
        amount: 0,
        stock_unit: { id: 2, name: "can", name_plural: null },
      },
    ],
  });
  assert.doesNotMatch(markup, /Old item/);
  assert.match(markup, /<option value="7">Synthetic beans/);
});

test("the shopping tab groups items by store, storeless last, and tells empty from failed", () => {
  const view = (shopping: ShoppingList) =>
    text(
      renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          createElement(PantryView, {
            person: 1,
            online: true,
            pantry: ready,
            failed: false,
            requests: undefined,
            requestsFailed: false,
            link: null,
            shopping,
          }),
        ),
      ),
    );
  const item = (id: number, name: string, unit: string | null) => ({
    id,
    name,
    amount: 2,
    unit,
    done: false,
  });
  const grouped = view({
    state: "ready",
    stores: [
      {
        store: { id: 1, name: "Wegmans" },
        items: [item(1, "Example broccoli", "Bags")],
      },
      { store: null, items: [item(2, "Example candles", null)] },
    ],
  });
  assert.match(
    grouped,
    /Shopping 2 .*Wegmans 1 Example broccoli 2 Bags No store 1 Example candles 2 /,
  );
  assert.match(view({ state: "ready", stores: [] }), /Nothing to buy/);
  assert.match(
    view({ state: "unavailable", stores: [] }),
    /Couldn’t load shopping list/,
  );
});
