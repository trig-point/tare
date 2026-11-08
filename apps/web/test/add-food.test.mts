import assert from "node:assert/strict";
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
import "fake-indexeddb/auto";
import { test } from "./support.mts";
import "./tsx.mts";

const { CatalogMiss, OnlineMiss } = await import("../src/add-food.tsx");
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
  for (const values of [{ kcal: "", protein_g: "" }, { kcal: "-1" }] as Record<
    string,
    string
  >[])
    await assert.rejects(enqueueNumbers(replay, owner, "Quick add", values));
  await enqueueNumbers(replay, owner, "Quick add", {
    kcal: "320",
    protein_g: "",
  });
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
