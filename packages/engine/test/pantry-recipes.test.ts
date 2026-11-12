import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { createGrocyClient } from "../src/grocy/client.ts";
import { createPantryService } from "../src/pantry/service.ts";
import { fixture } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { grocy as config, grocyFetch } from "./support/pantry-fake.ts";

// Values follow a disposable Grocy 4.7.1 capture, which returns native numbers.
const position = (
  recipe: number,
  recipe_pos_id: number,
  product_id: number,
  qu_id: number,
  [recipe_amount, missing_amount, stock_amount]: number[],
  anyStock = 0,
  child = recipe,
) => ({
  recipe_id: recipe,
  recipe_pos_id,
  product_id,
  qu_id,
  recipe_amount,
  missing_amount,
  stock_amount,
  need_fulfilled: missing_amount ? 0 : 1,
  only_check_single_unit_in_stock: anyStock,
  is_nested_recipe_pos: child === recipe ? 0 : 1,
  child_recipe_id: child,
});
const grocyData = () =>
  ({
    "/objects/recipes": [
      [1, "Synthetic toast", "normal", 2],
      [2, "Synthetic cake", "normal", 4],
      [3, "Synthetic empty", "normal", 1],
      [4, "2026-01-01#1", "mealplan-shadow", 1],
    ].map(([id, name, type, desired_servings]) => ({
      id,
      name,
      type,
      desired_servings,
    })),
    "/objects/recipes_pos_resolved": [
      position(1, 1, 3, 1, [5, 0, 100]),
      position(2, 2, 1, 2, [250, 125, 125]),
      position(2, 3, 2, 1, [100, 100, 0], 1),
      position(2, 4, 3, 2, [10, 10, 0], 0, 5),
      position(4, 5, 3, 1, [1, 0, 100]),
    ],
    "/objects/products": [
      { id: 1, name: "Synthetic flour", qu_id_stock: 1, active: 1 },
      { id: 2, name: "Synthetic eggs", qu_id_stock: 3, active: 1 },
      { id: 3, name: "Synthetic salt", qu_id_stock: 1, active: 1 },
    ],
    "/recipes/fulfillment": [1, 2, 3, 4].map((id) => ({
      recipe_id: id,
      need_fulfilled: id === 2 ? 0 : 1,
      need_fulfilled_with_shopping_list: id === 2 ? 0 : 1,
    })),
    "/objects/quantity_units": ["gram", "cup", "piece"].map((name, index) => ({
      id: index + 1,
      name,
      name_plural: null,
    })),
    "/objects/quantity_unit_conversions_resolved": [
      { product_id: 1, from_qu_id: 1, to_qu_id: 2, factor: 0.008 },
    ],
  }) as Record<string, unknown>;

function setupRecipes(context: TestContext) {
  const setup = fixture(context);
  const grocy = grocyFetch(grocyData());
  const client = createGrocyClient({
    config,
    ownerId: setup.admin.id,
    fetch: grocy.fetch,
  });
  const options = {
    database: setup.database,
    config,
    ownerId: setup.admin.id,
    clock: { now: () => new Date("2026-01-01T00:00:00Z") },
    client,
  };
  return {
    ...setup,
    routes: grocy.routes,
    hold: grocy.hold,
    service: createPantryService(options),
  };
}

test("recipes report Grocy fulfillment and missing amounts in their own units", async (context) => {
  const { service, admin } = setupRecipes(context);
  const result = await service.recipes(admin.id);
  assert.equal(result.state, "ready");
  assert.equal(result.deducts_stock, false);
  assert.deepEqual(
    result.recipes.map((recipe) => [
      `${recipe.name} ${recipe.need_fulfilled} ${recipe.nutrition.status}`,
      ...recipe.ingredients.map(
        (row) =>
          `${row.product_name} ${row.missing_amount} ${row.amount_unit.name} ${row.need_fulfilled} ${row.nested}: ${row.display_missing_amount} ${row.display_unit.name} ${row.conversion}`,
      ),
    ]),
    [
      [
        "Synthetic toast true none",
        "Synthetic salt 0 gram true false: 0 gram same_unit",
      ],
      [
        "Synthetic cake false none",
        "Synthetic flour 125 gram false false: 1 cup converted",
        "Synthetic eggs 100 gram false false: 100 gram same_unit",
        "Synthetic salt 10 gram false true: null cup conversion_unknown",
      ],
      ["Synthetic empty true none"],
    ],
  );
});

test("malformed or unjoinable Grocy reads make the whole recipe read unavailable", async (context) => {
  const setup = setupRecipes(context);
  for (const [path, body, reason] of [
    ["/objects/recipes_pos_resolved", [{ recipe_id: 1 }], "invalid_response"],
    ["/recipes/fulfillment", [], "invalid_response"],
    ["/objects/products", [], "invalid_response"],
    ["/objects/recipes", new Response("{}", { status: 500 }), "http"],
  ] as const) {
    Object.assign(setup.routes, grocyData(), { [path]: body });
    const result = await setup.service.recipes(setup.admin.id);
    assert.deepEqual(
      [result.state, result.recipes, result.error?.reason],
      ["unavailable", [], reason],
    );
  }
});

test("nutrition links scale the linked food, keep their basis, and clear on reset", async (context) => {
  const { service, admin, database, routes } = setupRecipes(context);
  const own = Number(
    database
      .prepare(
        "INSERT INTO foods (user_id, name, kcal, provenance) VALUES (?, 'Synthetic loaf', 100, 'label')",
      )
      .run(admin.id).lastInsertRowid,
  );
  const link = (change = {}) => ({
    recipe_id: 1,
    reference_kind: "food" as const,
    reference_id: own,
    servings: 2,
    ...change,
  });
  const nutrition = async () => {
    const { status, basis_matches, nutrients } =
      (await service.recipes(admin.id)).recipes[0]?.nutrition ?? {};
    return [status, basis_matches, nutrients?.kcal, nutrients?.protein_g];
  };
  const [toast] = routes["/objects/recipes"] as {
    desired_servings: number;
  }[];
  assert.ok(toast);
  await assert.rejects(service.saveLink(admin.id, link({ recipe_id: 4 })), {
    code: "pantry_recipe_missing",
  });
  await service.saveLink(admin.id, link({ recipe_id: 2 }));
  assert.equal(
    (await service.saveLink(admin.id, link())).link.desired_servings_at_link,
    2,
  );
  assert.deepEqual(await nutrition(), ["linked", true, 200, null]);
  toast.desired_servings = 4;
  assert.deepEqual(await nutrition(), ["linked", false, 200, null]);
  await service.saveLink(admin.id, link({ servings: 4 }));
  assert.deepEqual(await nutrition(), ["linked", true, 400, null]);
  toast.desired_servings = 0;
  await assert.rejects(service.saveLink(admin.id, link()), {
    code: "pantry_recipe_servings_invalid",
  });
  database.prepare("DELETE FROM foods WHERE id = ?").run(own);
  assert.deepEqual(await nutrition(), [
    "unresolved",
    false,
    undefined,
    undefined,
  ]);
  assert.deepEqual(
    [service.removeLink(admin.id, 1), service.removeLink(admin.id, 1)],
    [{ outcome: "deleted" }, { outcome: "not_found" }],
  );
  service.reset(admin.id, true);
  assert.deepEqual(
    database.prepare("SELECT COUNT(*) AS links FROM pantry_recipe_links").get(),
    { links: 0 },
  );
});

test("reads spanning a reset are discarded and shutdown drains reads", async (context) => {
  const { service, admin, hold } = setupRecipes(context);
  let held = hold("/objects/products");
  const spanning = service.recipes(admin.id);
  await held.reached;
  service.reset(admin.id, true);
  held.release();
  await assert.rejects(spanning, { code: "pantry_generation_changed" });
  held = hold("/recipes/fulfillment");
  const draining = service.recipes(admin.id);
  await held.reached;
  const stopped = service.stop();
  await assert.rejects(service.recipes(admin.id), { code: "pantry_stopping" });
  held.release();
  await assert.rejects(draining, { code: "pantry_stopping" });
  await stopped;
});
