import type { Database } from "better-sqlite3";
import { z } from "zod";
import { numbersFrom, nutrientKeys } from "../logging/schemas.ts";
import { mealNutritionState } from "../meal-nutrition/index.ts";
import {
  defineOperation,
  type OperationContext,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { isDue } from "../orders/index.ts";
import { readDayPlan } from "../plan/operations.ts";
import { planSchema } from "../plan/schema.ts";
import { listMealCandidates } from "../queries/orders/list-meal-candidates.ts";
import { selectOrder } from "../queries/orders/select-order.ts";
import { selectFood } from "../queries/select-food.ts";
import { selectSourceFood } from "../queries/select-source-food.ts";
import {
  assessAvailability,
  availabilitySchema,
  bindingStatus,
  stockRequests,
} from "./availability.ts";
import {
  pantryOutput,
  pantryProduct,
  pantryRecipesOutput,
  pantryReference,
} from "./service.ts";

const identifier = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const provenance = z.enum(["verified", "label", "estimated"]);
const nutrition = <Basis extends z.ZodType>(basis: Basis) =>
  z.strictObject({
    numbers: z.strictObject(
      Object.fromEntries(
        nutrientKeys.map((key) => [key, z.number().finite().nullable()]),
      ) as Record<(typeof nutrientKeys)[number], z.ZodNullable<z.ZodNumber>>,
    ),
    basis,
    source: z.string().nullable(),
    provenance: provenance.nullable(),
  });
const grocery = z.strictObject({
  reference: pantryReference,
  reference_name: z.string().nullable(),
  product_id: identifier,
  product_name: z.string().nullable(),
  stock_unit_id: identifier,
  stock_unit: pantryProduct.shape.stock_unit.nullable(),
  quantity_per_serving: z.number().positive().finite(),
  binding_status: bindingStatus,
  nutrition: nutrition(z.strictObject({ servings: z.literal(1) })),
  availability: availabilitySchema,
  action: z
    .union([
      z.strictObject({ kind: z.literal("plan_food"), food_id: identifier }),
      z.strictObject({
        kind: z.literal("log_source_food"),
        source_food_id: identifier,
      }),
    ])
    .nullable(),
});
const meal = z.strictObject({
  id: identifier,
  order_id: identifier,
  name: z.string(),
  chef: z.string().nullable(),
  quantity: z.number().int().positive(),
  revision: z.number().int(),
  delivery_date: z.string(),
  delivered_at: z.string().nullable(),
  service: z.string(),
  nutrition_state: z.union([
    z.strictObject({ status: z.literal("known"), food_id: identifier }),
    z.strictObject({ status: z.literal("pending"), question_id: identifier }),
    z.strictObject({ status: z.literal("unknown") }),
  ]),
  nutrition: nutrition(z.strictObject({ meals: z.literal(1) })),
  action: z.strictObject({ kind: z.literal("plan_meal"), meal_id: identifier }),
});
const metadata = pantryOutput.pick({
  state: true,
  generation: true,
  fetch_started_at: true,
  last_success_at: true,
  stale: true,
  error: true,
});
export const suggestionOutput = z.strictObject({
  state: metadata.shape.state,
  pantry: metadata,
  plan: planSchema.nullable(),
  groceries: z.array(grocery),
  unbound_stock: z.array(pantryProduct),
  meals: z.array(meal),
  recipes: pantryRecipesOutput,
  ingredient_deduction_automatic: z.literal(false),
});
type Snapshot = z.infer<typeof pantryOutput>;
const meta = ({
  products: _products,
  bindings: _bindings,
  requested: _requested,
  ...rest
}: Snapshot) => rest;

function nutritionOf(
  row: ReturnType<typeof selectFood> | ReturnType<typeof selectSourceFood>,
) {
  return {
    numbers: numbersFrom(row ?? {}),
    source: row?.source ?? null,
    provenance: row ? provenance.parse(row.provenance) : null,
  };
}

/** Disabled and reset installs say so without reading any private data. */
function closed(snapshot: Snapshot) {
  return {
    state: snapshot.state,
    pantry: meta(snapshot),
    plan: null,
    groceries: [],
    unbound_stock: [],
    meals: [],
    recipes: {
      state: snapshot.state,
      generation: snapshot.generation,
      fetched_at: null,
      error: null,
      deducts_stock: false,
      recipes: [],
    },
    ingredient_deduction_automatic: false,
  };
}

function groceries(database: Database, userId: number, snapshot: Snapshot) {
  const requests =
    snapshot.generation === null
      ? []
      : stockRequests(
          database,
          userId,
          snapshot.generation,
          snapshot.fetch_started_at,
        );
  return snapshot.bindings.map((binding) => {
    const food =
      binding.reference_kind === "food"
        ? selectFood(database, { user_id: userId, id: binding.reference_id })
        : selectSourceFood(database, { id: binding.reference_id });
    const product = snapshot.products.find(
      (row) => row.product_id === binding.product_id,
    );
    return {
      reference: {
        reference_kind: binding.reference_kind,
        reference_id: binding.reference_id,
      },
      reference_name: food?.name ?? null,
      product_id: binding.product_id,
      product_name: product?.name ?? null,
      stock_unit_id: binding.stock_unit_id,
      stock_unit: product?.stock_unit ?? null,
      quantity_per_serving: binding.quantity_per_serving,
      binding_status: binding.status,
      nutrition: { ...nutritionOf(food), basis: { servings: 1 } },
      availability: assessAvailability(snapshot, binding, requests, 1),
      action: !food
        ? null
        : binding.reference_kind === "food"
          ? { kind: "plan_food", food_id: food.id }
          : { kind: "log_source_food", source_food_id: food.id },
    };
  });
}

function meals(
  database: Database,
  person: ReturnType<typeof operationPerson>,
  now: string,
) {
  const services = new Map<number, string>();
  return listMealCandidates(database, { user_id: person.id })
    .filter((row) => isDue(row, person, now))
    .sort((left, right) => left.id - right.id)
    .map((row) => {
      let service = services.get(row.order_id);
      if (service === undefined) {
        const order = selectOrder(database, {
          user_id: person.id,
          id: row.order_id,
        });
        if (!order) throw new Error("Meal order is missing");
        service = order.service;
        services.set(row.order_id, service);
      }
      const state = mealNutritionState(database, person.id, {
        service,
        name: row.name,
        chef: row.chef,
      });
      const food =
        state.status === "known"
          ? selectFood(database, { user_id: person.id, id: state.food_id })
          : null;
      return {
        ...row,
        service,
        nutrition_state: state,
        nutrition: { ...nutritionOf(food), basis: { meals: 1 } },
        action: { kind: "plan_meal", meal_id: row.id },
      };
    });
}

async function suggestionContext(context: OperationContext) {
  const person = operationPerson(context);
  const service = context.pantry;
  if (!service) {
    // A configured install without its service cannot honestly answer any caller.
    if (context.config.grocy)
      throw new OperationError(503, "pantry_unavailable");
    return closed(
      pantryOutput.parse({
        state: "disabled",
        generation: null,
        fetch_started_at: null,
        last_success_at: null,
        stale: true,
        error: null,
        products: [],
        bindings: [],
        requested: [],
      }),
    );
  }
  const before = service.read(person.id);
  if (before.state === "disabled" || before.state === "reset_required")
    return closed(before);
  let recipes: Awaited<ReturnType<typeof service.recipes>> | undefined;
  try {
    recipes = await service.recipes(person.id);
  } catch (caught) {
    if (
      !(caught instanceof OperationError) ||
      caught.code !== "pantry_generation_changed"
    )
      throw caught;
  }
  const now = context.clock.now();
  const after = service.read(person.id, now);
  if (after.generation !== before.generation)
    throw new OperationError(409, "pantry_generation_changed");
  if (after.state === "reset_required") return closed(after);
  if (!recipes) throw new OperationError(409, "pantry_generation_changed");
  const bound = new Set(after.bindings.map((binding) => binding.product_id));
  return {
    state: after.state,
    pantry: meta(after),
    plan: readDayPlan(context.database, person, now, context.config),
    groceries: groceries(context.database, person.id, after),
    unbound_stock: after.products.filter(
      (product) => product.amount > 0 && !bound.has(product.product_id),
    ),
    meals: meals(context.database, person, now.toISOString()),
    recipes,
    ingredient_deduction_automatic: false,
  };
}

export const pantrySuggestionContext = defineOperation({
  name: "pantry_suggestion_context",
  description:
    "Read the pantry owner's meal ideas: bound groceries with advisory stock, unbound stock, meals on hand, Grocy recipes and today's slot budgets. Stock is as of the last refresh and nothing is reserved; binding status is as of its save or the last refresh. Plan foods and meals with plan_slot; log source foods directly. Cooking a recipe never deducts its ingredients.",
  method: "GET",
  path: "/api/pantry/suggestions",
  modes: ["access", "fallback"],
  callerClass: "browser_and_agent",
  admin: false,
  input: z.strictObject({}),
  output: suggestionOutput,
  async handler(_input, context) {
    return { status: 200, body: await suggestionContext(context) };
  },
});
