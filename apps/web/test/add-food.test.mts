import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { upsertSourceFood } from "../../../packages/engine/src/queries/upsert-source-food.ts";
import { twoUsers } from "../../../packages/engine/test/support/two-users.ts";
import {
  catalogQuery,
  enqueueFood,
  enqueueNumbers,
  type FoodChoice,
  mergeChoices,
  searchOnline,
} from "../src/food-api.ts";
import { OutboxReplay } from "../src/outbox-replay.ts";
import { openOutboxStore } from "../src/outbox-store.ts";
import { type Intake, readToday, todayKey } from "../src/today-api.ts";
import "fake-indexeddb/auto";
import { test } from "./support.mts";
import "./tsx.mts";

const { AddFood, CatalogMiss, OnlineMiss, QuickAdd, usualFoods } = await import(
  "../src/add-food.tsx"
);
const onlineFood = {
  source_food_id: 7,
  source: "usda" as const,
  source_key: "100",
  name: "Example rolled oats",
  brand: "Example Mill",
  barcode: null,
  serving_size: 40,
  serving_unit: "g",
  kcal: 150,
  protein_g: 5,
  carbs_g: 27,
  fat_g: 3,
  fiber_g: 4,
  provenance: "label" as const,
  fetched_at: "2026-11-01T12:00:00.000Z",
};
function stubSearch(
  context: Parameters<typeof twoUsers>[0],
  result: "match" | "ambiguous" | "no_match",
) {
  const paths: string[] = [];
  context.mock.method(globalThis, "fetch", async (path: string) => {
    paths.push(path);
    return Response.json({
      result,
      foods: result === "no_match" ? [] : [onlineFood],
      sources: { usda: "ok", off: "not_called" },
    });
  });
  return paths;
}

test("typing calls find_food only", async (context) => {
  const setup = await twoUsers(context, "fallback");
  const { source_food_id: _id, ...row } = onlineFood;
  upsertSourceFood(setup.database, row);
  const paths: string[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    (path: string, init: RequestInit) => {
      paths.push(path);
      return setup.admin.request(path, init);
    },
  );
  const typed = "Example rolled oats";
  const results = [];
  for (let length = 1; length <= typed.length; length++)
    results.push(
      await catalogQuery(setup.admin.user.id, typed.slice(0, length)).queryFn({
        signal: new AbortController().signal,
      }),
    );
  const last = results.at(-1);
  assert.ok(last);
  assert.equal(paths.length, typed.length);
  assert.ok(paths.every((path) => path === "/api/foods/find"));
  assert.equal(last.result, "match");
  assert.deepEqual(
    last.foods.map((food) => [food.name, food.reference.kind, food.kcal]),
    [["Example rolled oats", "source_food", 150]],
  );
});

test("search online calls once and offers only exact matches", async (context) => {
  const paths = stubSearch(context, "match");
  const foods = await searchOnline(" Example rolled oats ");
  assert.deepEqual(paths, ["/api/lookup/search"]);
  assert.deepEqual(
    foods.map((food) => [food.reference, food.serving]),
    [[{ kind: "source_food", id: 7 }, "40 g"]],
  );
  for (const result of ["ambiguous", "no_match"] as const) {
    stubSearch(context, result);
    assert.deepEqual(await searchOnline("Example rolled oats"), []);
  }
  context.mock.method(globalThis, "fetch", async () => Response.json({}));
  await assert.rejects(searchOnline("Example rolled oats"));
  const [online] = foods;
  assert.ok(online);
  const other = {
    ...online,
    reference: { kind: "source_food" as const, id: 8 },
  };
  assert.deepEqual(mergeChoices([online], [{ ...online }]), [online]);
  assert.deepEqual(mergeChoices([online], [other]), [online, other]);
});

test("a miss offers manual entry", () => {
  const render = (result: "match" | "ambiguous" | "no_match") =>
    renderToStaticMarkup(
      createElement(CatalogMiss, { result, enterManually: () => {} }),
    );
  for (const result of ["no_match", "ambiguous"] as const)
    assert.match(render(result), /No match.*Enter manually/);
  assert.equal(render("match"), "");
  assert.match(
    renderToStaticMarkup(
      createElement(OnlineMiss, { enterManually: () => {} }),
    ),
    /No exact match.*Enter manually/,
  );
  const withoutManual = renderToStaticMarkup(createElement(OnlineMiss, {}));
  assert.match(withoutManual, /No exact match/);
  assert.doesNotMatch(withoutManual, /Enter manually/);
});

test("quick add stores an estimated entry", async (context) => {
  const setup = await twoUsers(context, "fallback");
  const store = await openOutboxStore({ name: `food-${crypto.randomUUID()}` });
  const replay = new OutboxReplay({
    store,
    online: () => false,
    channel: null,
    events: null,
  });
  context.after(async () => {
    await replay.close();
    store.close();
  });
  const owner = setup.admin.user;
  await store.cacheSession(0, { user: owner, mode: "fallback" });
  for (const values of [
    { kcal: "", protein_g: "" },
    { kcal: "-1" },
    { kcal: " ", protein_g: "30" },
  ] as Record<string, string>[])
    await assert.rejects(
      enqueueNumbers(replay, owner, "Quick add", values, ["kcal"]),
    );
  await enqueueNumbers(
    replay,
    owner,
    "Quick add",
    { kcal: "320", protein_g: "" },
    ["kcal"],
  );
  const [entry] = await store.entries(owner.id);
  assert.ok(entry);
  const response = await setup.admin.request("/api/intake", {
    method: "POST",
    body: JSON.stringify(entry.body),
  });
  assert.equal(response.status, 201);
  const { entry: stored } = await response.json();
  assert.deepEqual(
    [stored.name, stored.kcal, stored.protein_g, stored.provenance],
    ["Quick add", 320, null, "estimated"],
  );
});

test("a matched food logs by reference with servings", async (context) => {
  const setup = await twoUsers(context, "fallback");
  const { source_food_id: _id, ...row } = onlineFood;
  const seeded = upsertSourceFood(setup.database, row);
  assert.ok(seeded);
  const store = await openOutboxStore({ name: `food-${crypto.randomUUID()}` });
  const replay = new OutboxReplay({
    store,
    online: () => false,
    channel: null,
    events: null,
  });
  context.after(async () => {
    await replay.close();
    store.close();
  });
  const owner = setup.admin.user;
  await store.cacheSession(0, { user: owner, mode: "fallback" });
  const food: FoodChoice = {
    reference: { kind: "source_food", id: seeded.id },
    name: row.name,
    brand: row.brand,
    serving: "40 g",
    kcal: row.kcal,
    protein_g: row.protein_g,
  };
  for (const servings of ["", "0", "-1", "abc"])
    await assert.rejects(enqueueFood(replay, owner, food, servings));
  await enqueueFood(replay, owner, food, "0.5");
  const [entry] = await store.entries(owner.id);
  assert.ok(entry);
  const response = await setup.admin.request("/api/intake", {
    method: "POST",
    body: JSON.stringify(entry.body),
  });
  assert.equal(response.status, 201);
  const { entry: stored } = await response.json();
  assert.deepEqual([stored.source_food_id, stored.servings], [seeded.id, 0.5]);
});

function entry(id: number, fields: Partial<Intake>): Intake {
  return {
    id,
    client_id: `entry-${id}`,
    name: `Example food ${id}`,
    food_id: null,
    source_food_id: null,
    servings: 1,
    eaten_at: `2026-11-01T0${id}:00:00.000Z`,
    provenance: "label",
    source: null,
    kcal_low: null,
    kcal_high: null,
    kcal: 200,
    protein_g: 10,
    carbs_g: null,
    fat_g: null,
    fiber_g: null,
    ...fields,
  };
}

test("usual foods list each food once, newest first, per serving", () => {
  const foods = usualFoods([
    entry(1, { food_id: 5, servings: 1 }),
    entry(2, { name: "Quick add", servings: null }),
    entry(3, { source_food_id: 9, servings: 2, kcal: 300, protein_g: null }),
    entry(4, { food_id: 5, name: "Example oats", servings: 0.5, kcal: 90 }),
  ]);
  assert.deepEqual(
    foods.map((food) => [food.reference, food.name, food.kcal, food.protein_g]),
    [
      [{ kind: "food", id: 5 }, "Example oats", 180, 20],
      [{ kind: "source_food", id: 9 }, "Example food 3", 150, null],
    ],
  );
  assert.deepEqual(usualFoods([]), []);
});

function renderAddFood(
  person: { id: number; username: string },
  client: QueryClient,
) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(AddFood, {
        person,
        replay: {} as OutboxReplay,
        online: true,
      }),
    ),
  );
}

test("add food opens on Search with usual foods before typing", async (context) => {
  const { admin } = await twoUsers(context, "fallback");
  context.mock.method(globalThis, "fetch", (path: string, init: RequestInit) =>
    admin.request(path, init),
  );
  const client = new QueryClient();
  const today = await readToday(new AbortController().signal);
  client.setQueryData(todayKey(admin.user.id), {
    ...today,
    entries: [
      entry(1, { food_id: 5, name: "Example oats" }),
      entry(2, { food_id: 6, kcal: null }),
    ],
  });
  const html = renderAddFood(admin.user, client);
  const tabs = [...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map(
    (match) => match[1],
  );
  assert.deepEqual(tabs, ["Search", "Scan", "Quick add"]);
  assert.match(html, /Log again/);
  assert.match(html, /id="servings-food-5"[^>]*value="1"/);
  assert.match(html, /aria-label="Log Example oats"/);
  assert.match(html, /Unknown kcal/);
  assert.match(
    html,
    /data-state="inactive"[^>]*data-\[state=inactive\]:hidden[^>]*><form aria-label="Quick add"/,
  );
  const failed = new QueryClient({
    defaultOptions: { queries: { retryOnMount: false } },
  });
  failed
    .getQueryCache()
    .build(failed, { queryKey: todayKey(admin.user.id) })
    .setState({ status: "error", error: new Error("Unavailable") });
  const failedHtml = renderAddFood(admin.user, failed);
  assert.match(failedHtml, /role="alert">Couldn’t load today’s foods/);
  assert.doesNotMatch(failedHtml, /Foods you log today show here/);
});

test("quick add requires calories only", () => {
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(QuickAdd, {
        person: { id: 1, username: "example" },
        replay: {} as OutboxReplay,
        done: () => {},
      }),
    ),
  );
  const requiredFields = [
    ...html.matchAll(/<input[^>]*id="quick-add-(\w+)"[^>]*>/g),
  ]
    .filter((match) => / required=""/.test(match[0]))
    .map((match) => match[1]);
  assert.deepEqual(requiredFields, ["kcal"]);
  assert.match(html, /Fiber.*\(g, optional\)/);
});
