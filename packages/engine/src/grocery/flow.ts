import type { Database } from "better-sqlite3";
import { z } from "zod";
import {
  checkOwnedFood,
  ownedFoodInput,
  ownedFoodValues,
} from "../foods/create.ts";
import type { GrocyResult } from "../grocy/client.ts";
import type { GrocyConfig } from "../grocy/config.ts";
import { type createGroceryClient, findable } from "../grocy/grocery.ts";
import { OperationError } from "../operations/registry.ts";
import { readBindingToken } from "../queries/grocery/read-binding-token.ts";
import { readRequestById } from "../queries/grocery/read-request-by-id.ts";
import { readConnection } from "../queries/pantry/read-connection.ts";
import { selectFood } from "../queries/select-food.ts";
import * as store from "./store.ts";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const amount = z.number().positive().finite();
// Names the Grocy client can look up and create; anything else would fail as a read error later.
const label = z.string().max(100).refine(findable);
const reuseOr = <Create extends z.ZodType>(create: Create) =>
  z.union([z.strictObject({ id }), z.strictObject({ create })]);
export const groceryInput = z.strictObject({
  food: z.union([
    z.strictObject({ food_id: id }),
    z.strictObject({ create: ownedFoodInput }),
  ]),
  unit: reuseOr(z.strictObject({ name: label, name_plural: label })),
  location: reuseOr(z.strictObject({ name: label })),
  product: reuseOr(z.strictObject({ name: label })),
  barcode: z
    .strictObject({
      code: z
        .string()
        .regex(/^[0-9A-Za-z]{1,48}$/)
        .refine(findable),
      amount,
    })
    .nullable(),
  amount,
  purchased_date: z.iso.date(),
  best_before_date: z.union([z.iso.date(), z.literal("never")]),
  quantity_per_serving: amount,
});
const bindingSeen = z
  .strictObject({ change_token: z.uuid(), status: z.string().max(40) })
  .nullable();
export const groceryPlan = groceryInput.extend({
  food_seen: z.string().length(64).nullable(),
  generation: id,
  restore_nonce: z.string().regex(/^[0-9a-f]{32}$/),
  binding_seen: bindingSeen,
  overlaps: z.array(z.uuid()).max(100),
});
type Input = z.output<typeof groceryInput>;
type Plan = z.output<typeof groceryPlan>;
const issue = z.strictObject({ code: z.string(), id: id.nullable() });
const step = z.strictObject({
  number: id,
  kind: z.enum(store.stepOrder),
  state: z.string(),
  reason: z.string().nullable(),
  object_id: id.nullable(),
  transaction_id: z.string().nullable(),
});
const request = z.strictObject({
  mutation_id: z.string(),
  state: z.string(),
  food_id: id,
  generation: id,
  steps: z.array(step).max(5),
  stopped: z.string().nullable(),
  candidates: z
    .strictObject({
      transactions: z.array(z.string()).max(10),
      complete: z.boolean(),
    })
    .nullable(),
});
export const groceryProposal = z.strictObject({
  outcome: z.enum(["plan", "blocked"]),
  plan: groceryPlan.nullable(),
  steps: z.array(z.enum(store.stepOrder)),
  issues: z.array(issue),
  food: z.strictObject({
    name: z.string(),
    serving_size: z.number().nullable(),
    serving_unit: z.string().nullable(),
    kcal: z.number().nullable(),
  }),
});
export const groceryStatus = z.strictObject({
  request: request.nullable(),
  open: z.array(z.strictObject({ mutation_id: z.string(), state: z.string() })),
  restore_nonce: z.string(),
});

const created = (plan: Pick<Plan, "unit" | "location" | "product">) =>
  (["unit", "location", "product"] as const).filter(
    (kind) => "create" in plan[kind],
  );
/** Steps follow the plan alone, so a replayed plan always numbers them the same way. */
const planSteps = (plan: Input): store.StepKind[] => [
  ...created(plan),
  ...(plan.barcode ? (["barcode"] as const) : []),
  "stock_add",
];
const touches = (plan: Input, foodId?: number, productId?: number | null) =>
  [
    `food:${"food_id" in plan.food ? plan.food.food_id : foodId}`,
    "id" in plan.product
      ? `product:${plan.product.id}`
      : `name:${plan.product.create.name}`,
    productId ? `product:${productId}` : "",
    plan.barcode ? `barcode:${plan.barcode.code}` : "",
  ].filter((key) => key && !key.endsWith(":undefined"));

/** Grocy stores barcodes as raw text, but a UPC-A and its zero-padded EAN-13 are one code. */
const barcodeForms = (code: string) =>
  /^\d{12}$/.test(code)
    ? [code, `0${code}`]
    : /^0\d{12}$/.test(code)
      ? [code, code.slice(1)]
      : [code];

export type GroceryService = ReturnType<typeof createGroceryService>;

export function createGroceryService({
  database,
  config,
  ownerId,
  client,
}: {
  database: Database;
  config: GrocyConfig | null;
  ownerId: number | null;
  client: ReturnType<typeof createGroceryClient>;
}) {
  const owner = ownerId ?? 0;
  function admit(userId: number) {
    if (!config || ownerId === null)
      throw new OperationError(503, "pantry_disabled");
    if (userId !== ownerId) throw new OperationError(403, "forbidden");
  }
  /** A read's value; null only for a reused id Grocy does not have. */
  async function maybe<Value>(work: Promise<GrocyResult<Value> | undefined>) {
    const result = await work;
    if (result?.status === "ok") return result.value;
    if (result && "reason" in result && result.reason === "not_found")
      return null;
    throw new OperationError(503, "pantry_read_failed");
  }
  async function live<Value>(work: Promise<GrocyResult<Value> | undefined>) {
    const value = await maybe(work);
    if (value === null) throw new OperationError(503, "pantry_read_failed");
    return value;
  }
  async function checkVersion() {
    const result = await client.requireSupportedVersion(owner);
    if (result?.status === "ok") return null;
    return result && "reason" in result ? result.reason : "response_withheld";
  }
  function overlaps(plan: Input, self: string | null) {
    if (store.openGroceryCount(database) > 100)
      throw new OperationError(503, "grocery_overlaps_unbounded");
    const keys = new Set(touches(plan));
    return store
      .openGroceries(database, 100)
      .filter((row) => row.mutation_id !== self)
      .filter((row) => {
        const found = readRequestById(database, { id: row.id });
        if (!found) return false;
        let stored: unknown;
        try {
          stored = JSON.parse(found.plan);
        } catch {
          stored = null;
        }
        const other = groceryPlan.safeParse(stored);
        const productStep = store
          .readGrocery(database, found.user_id, found.mutation_id)
          ?.steps.find((step) => step.kind === "product");
        // An unreadable plan cannot prove it is unrelated.
        return (
          !other.success ||
          touches(other.data, found.food_id, productStep?.object_id).some(
            (key) => keys.has(key),
          )
        );
      })
      .map((row) => row.mutation_id)
      .sort();
  }

  /** Read-only: every Grocy and local read the plan depends on, frozen into one value. */
  async function propose(userId: number, input: Input) {
    admit(userId);
    const row = readConnection(database);
    if (!row || row.reset_required || row.user_id !== ownerId)
      throw new OperationError(503, "pantry_reset_required");
    const version = await checkVersion();
    if (version) throw new OperationError(503, `grocy_${version}`.slice(0, 40));
    const issues: z.output<typeof issue>[] = [];
    const flag = (code: string, found: number | null = null) =>
      issues.push({ code, id: found });
    let food: z.output<typeof groceryProposal>["food"];
    let foodSeen: string | null = null;
    if ("food_id" in input.food) {
      const owned = selectFood(database, {
        user_id: userId,
        id: input.food.food_id,
      });
      if (!owned) throw new OperationError(404, "food_not_found");
      food = owned;
      foodSeen = store.foodFingerprint(owned);
    } else {
      checkOwnedFood(database, ownedFoodValues(input.food.create));
      food = input.food.create;
    }
    const unit =
      "id" in input.unit
        ? await maybe(client.unit(owner, input.unit.id))
        : (await live(client.unitNamed(owner, input.unit.create.name)))[0];
    if ("id" in input.unit ? unit?.active !== 1 : unit)
      flag(
        "id" in input.unit
          ? unit
            ? "unit_inactive"
            : "unit_missing"
          : "unit_exists",
        "id" in input.unit ? input.unit.id : unit?.id,
      );
    const location =
      "id" in input.location
        ? await maybe(client.location(owner, input.location.id))
        : (
            await live(client.locationNamed(owner, input.location.create.name))
          )[0];
    if ("id" in input.location ? location?.active !== 1 : location)
      flag(
        "id" in input.location
          ? location
            ? "location_inactive"
            : "location_missing"
          : "location_exists",
        "id" in input.location ? input.location.id : location?.id,
      );
    const product =
      "id" in input.product
        ? await maybe(client.product(owner, input.product.id))
        : (
            await live(client.productNamed(owner, input.product.create.name))
          )[0];
    if (!("id" in input.product)) {
      if (product) flag("product_exists", product.id);
    } else if (product?.active !== 1)
      flag(product ? "product_inactive" : "product_missing", input.product.id);
    else if (product.enable_tare_weight_handling === 1)
      flag("product_tare", product.id);
    else if (!("id" in input.unit) || product.qu_id_stock !== input.unit.id)
      flag("unit_mismatch", product.qu_id_stock);
    let barcode = input.barcode;
    if (barcode) {
      const rows = [];
      for (const form of barcodeForms(barcode.code))
        rows.push(...(await live(client.barcodeRows(owner, form))));
      const [taken] = rows;
      if (
        rows.length &&
        rows.every(
          (row) => "id" in input.product && row.product_id === input.product.id,
        )
      )
        barcode = null;
      else if (taken)
        flag(
          "barcode_taken",
          rows.find(
            (row) =>
              !("id" in input.product) || row.product_id !== input.product.id,
          )?.product_id ?? taken.product_id,
        );
    }
    const seen =
      "food_id" in input.food
        ? readBindingToken(database, {
            user_id: userId,
            generation: row.generation,
            reference_id: input.food.food_id,
          })
        : null;
    if (
      seen &&
      (!("id" in input.product) || seen.product_id !== input.product.id)
    )
      flag("food_bound", seen.product_id);
    const plan = groceryPlan.parse({
      ...input,
      food:
        "food_id" in input.food
          ? input.food
          : { create: ownedFoodValues(input.food.create) },
      barcode,
      food_seen: foodSeen,
      generation: row.generation,
      restore_nonce: store.currentNonce(database),
      binding_seen: seen && {
        change_token: seen.change_token,
        status: seen.status,
      },
      overlaps: [],
    });
    plan.overlaps = overlaps(plan, null);
    return groceryProposal.parse({
      outcome: issues.length ? "blocked" : "plan",
      plan: issues.length ? null : plan,
      steps: planSteps(plan),
      issues,
      food: {
        name: food.name,
        serving_size: food.serving_size,
        serving_unit: food.serving_unit,
        kcal: food.kcal,
      },
    });
  }

  function view(
    userId: number,
    mutationId: string,
    stopped: string | null = null,
    candidates: z.output<typeof request>["candidates"] = null,
  ) {
    const found = store.readGrocery(database, userId, mutationId);
    return groceryStatus.parse({
      request: found && {
        mutation_id: found.request.mutation_id,
        state: found.request.state,
        food_id: found.request.food_id,
        generation: found.request.generation,
        steps: found.steps.map(
          ({ product_id, stock_log_max, updated_at, ...step }) => step,
        ),
        stopped,
        candidates,
      },
      open:
        userId === ownerId
          ? store.openGroceries(database, 100).map((row) => ({
              mutation_id: row.mutation_id,
              state: row.state,
            }))
          : [],
      restore_nonce: store.currentNonce(database),
    });
  }

  /** Candidates come only from the request's own live connection; a failed read lists none and is incomplete. */
  async function status(userId: number, mutationId?: string) {
    if (mutationId === undefined) {
      admit(userId);
      return view(userId, "");
    }
    const found = store.readGrocery(database, userId, mutationId);
    if (!found) throw new OperationError(404, "grocery_not_found");
    const add = found.steps.find(
      (step) => step.kind === "stock_add" && step.state === "uncertain",
    );
    const row = readConnection(database);
    const live =
      !!config &&
      userId === ownerId &&
      !!row &&
      !row.reset_required &&
      row.user_id === found.request.user_id &&
      row.generation === found.request.generation &&
      row.url === found.request.url &&
      row.username === found.request.username;
    let candidates: z.output<typeof request>["candidates"] = null;
    if (live && add?.product_id && add.stock_log_max !== null) {
      const after = await client.purchasesAfter(
        owner,
        add.product_id,
        add.stock_log_max,
        10,
      );
      candidates =
        after?.status === "ok"
          ? {
              transactions: [
                ...new Set(
                  after.value.rows
                    .filter((row) => row.undone === 0)
                    .map((row) => row.transaction_id),
                ),
              ],
              complete: after.value.complete,
            }
          : { transactions: [], complete: false };
    }
    return view(userId, mutationId, null, candidates);
  }
  return { propose, status };
}
