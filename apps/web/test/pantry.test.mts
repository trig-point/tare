import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pantryHarness } from "../../../packages/engine/test/support/pantry-fake.ts";
import { ApiError } from "../src/api.ts";
import {
  type Pantry,
  readLink,
  readPantry,
  readRequests,
  reconcile,
  type StockRequests,
} from "../src/pantry-api.ts";
import { test } from "./support.mts";
import "./tsx.mts";

const { PantryView } = await import("../src/pantry.tsx");

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
const render = (pantry: Pantry, requests?: StockRequests) =>
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
      }),
    ),
  );
const empty = {
  ...ready,
  generation: null,
  last_success_at: null,
  products: [],
};

test("a disabled pantry says so instead of showing empty stock", () => {
  const markup = render({ ...empty, state: "disabled", stale: true });
  assert.match(markup, /Pantry not set up/);
  assert.doesNotMatch(markup, /No stock|>Refresh</);
});

test("a reset-required pantry offers a reset and no bindings", () => {
  const markup = render({ ...empty, state: "reset_required", generation: 1 });
  assert.match(markup, /Pantry connection needs a reset/);
  assert.match(markup, />Reset connection</);
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
  assert.match(markup, /Synthetic beans<\/strong> 4 can/);
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

test("abandoning a pending request moves it to history and keeps its error code", async (context) => {
  const harness = await pantryHarness(context);
  context.mock.method(globalThis, "fetch", harness.admin.request);
  harness.bind("food", 1, 7);
  harness.request(1, "pending", 2);
  const open = await readRequests();
  const [request] = open.unresolved;
  assert.ok(request);
  assert.match(
    render(await readPantry(), open),
    /Food 1: 2 pending<\/strong><p class="actions"><button type="button">Abandon</,
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
  assert.match(render(await readPantry(), after), /Recent requests.*abandoned/);
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
