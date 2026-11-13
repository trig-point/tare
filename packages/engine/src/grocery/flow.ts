import { createHash } from "node:crypto";
import type { Database } from "better-sqlite3";
import { z } from "zod";
import { writeTransaction } from "../db.ts";
import {
  checkOwnedFood,
  ownedFoodInput,
  ownedFoodValues,
} from "../foods/create.ts";
import type { GrocyResult } from "../grocy/client.ts";
import type { GrocyConfig } from "../grocy/config.ts";
import {
  type createGroceryClient,
  findable,
  neverExpires,
  purchaseMatches,
} from "../grocy/grocery.ts";
import { OperationError } from "../operations/registry.ts";
import { listSteps } from "../queries/grocery/list-steps.ts";
import { readBindingToken } from "../queries/grocery/read-binding-token.ts";
import { readDecision } from "../queries/grocery/read-decision.ts";
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
/** Grocy stores barcodes as raw text, but a UPC-A and its zero-padded EAN-13 are one code. */
const barcodeForms = (code: string) =>
  /^\d{12}$/.test(code)
    ? [code, `0${code}`]
    : /^0\d{12}$/.test(code)
      ? [code, code.slice(1)]
      : [code];
const touches = (plan: Input, foodId?: number, productId?: number | null) =>
  [
    `food:${"food_id" in plan.food ? plan.food.food_id : foodId}`,
    "id" in plan.product
      ? `product:${plan.product.id}`
      : `name:${plan.product.create.name}`,
    productId ? `product:${productId}` : "",
    ...(plan.barcode
      ? barcodeForms(plan.barcode.code).map((form) => `barcode:${form}`)
      : []),
  ].filter((key) => key && !key.endsWith(":undefined"));

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
/** A stable UUID for the request's own binding decision, so a retried bind replays. */
const bindDecision = (mutationId: string) =>
  sha256(`${mutationId}:bind`)
    .slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

export type GroceryService = ReturnType<typeof createGroceryService>;

export function createGroceryService({
  database,
  config,
  ownerId,
  clock,
  client,
  refresh,
  report = () => {},
}: {
  database: Database;
  config: GrocyConfig | null;
  ownerId: number | null;
  clock: { now(): Date };
  client: ReturnType<typeof createGroceryClient>;
  refresh: () => Promise<unknown>;
  report?: (code: string) => void;
}) {
  const owner = ownerId ?? 0;
  let stopping = false;
  // One engine process per database: the mutex holds the admitted plan until its request is stored and run.
  let active: { mutationId: string; hash: string } | null = null;
  const tracked = new Set<Promise<unknown>>();
  function track<Value>(work: Promise<Value>) {
    tracked.add(work);
    const release = () => tracked.delete(work);
    work.then(release, release);
    return work;
  }
  function admit(userId: number) {
    if (!config || ownerId === null)
      throw new OperationError(503, "pantry_disabled");
    if (userId !== ownerId) throw new OperationError(403, "forbidden");
    if (stopping) throw new OperationError(503, "pantry_stopping");
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
        const productStep = listSteps(database, {
          request_id: found.id,
        }).find((step) => step.kind === "product");
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

  const canonical = (plan: Plan) => JSON.stringify(groceryPlan.parse(plan));
  type Steps = NonNullable<ReturnType<typeof store.readGrocery>>["steps"];
  const resolved = (
    plan: Plan,
    steps: Steps,
    kind: "unit" | "location" | "product",
  ) => {
    const reuse = plan[kind];
    return "id" in reuse
      ? reuse.id
      : (steps.find((step) => step.kind === kind)?.object_id ?? 0);
  };
  const addOf = (plan: Plan, locationId: number) => ({
    amount: plan.amount,
    best_before_date:
      plan.best_before_date === "never"
        ? neverExpires.bestBeforeDate
        : plan.best_before_date,
    purchased_date: plan.purchased_date,
    location_id: locationId,
  });
  const defaultDays = (plan: Plan) =>
    plan.best_before_date === "never" ? neverExpires.defaultDays : 0;
  // Runs only after the purchase is committed; a failed refresh stays visible on the pantry read.
  const queueRefresh = () =>
    void refresh().catch(() => report("pantry_refresh_failed"));

  function bind(mutationId: string) {
    const found = store.readGrocery(database, owner, mutationId);
    if (found?.request.state !== "binding_pending") return null;
    const plan = groceryPlan.parse(JSON.parse(found.request.plan));
    try {
      store.bindGrocery(
        database,
        {
          ownerId,
          userId: owner,
          mutationId: bindDecision(found.request.mutation_id),
          requestId: found.request.id,
          restoreNonce: store.currentNonce(database),
          expected: plan.binding_seen,
          binding: {
            product_id: resolved(plan, found.steps, "product"),
            stock_unit_id: resolved(plan, found.steps, "unit"),
            quantity_per_serving: plan.quantity_per_serving,
          },
        },
        clock,
      );
      return null;
    } catch (caught) {
      if (caught instanceof OperationError) return caught.code;
      throw caught;
    }
  }

  async function send(plan: Plan, kind: store.StepKind, steps: Steps) {
    const unitId = resolved(plan, steps, "unit");
    const locationId = resolved(plan, steps, "location");
    const productId = resolved(plan, steps, "product");
    if (kind === "unit" && "create" in plan.unit)
      return client.createUnit(owner, plan.unit.create);
    if (kind === "location" && "create" in plan.location)
      return client.createLocation(owner, plan.location.create);
    if (kind === "product" && "create" in plan.product)
      return client.createProduct(owner, {
        name: plan.product.create.name,
        location_id: locationId,
        qu_id_stock: unitId,
        default_best_before_days: defaultDays(plan),
      });
    if (kind === "barcode" && plan.barcode)
      return client.createBarcode(owner, {
        product_id: productId,
        barcode: plan.barcode.code,
        qu_id: unitId,
        amount: plan.barcode.amount,
      });
    return client.addStock(owner, productId, addOf(plan, locationId));
  }

  /** Sends each claimed step once and stops at the first step that is not confirmed. */
  async function run(mutationId: string, plan: Plan) {
    while (true) {
      const found = store.readGrocery(database, owner, mutationId);
      if (!found) throw new Error("Grocery request missing");
      if (found.request.state === "binding_pending") return bind(mutationId);
      const next = found.steps.find(
        (step) => step.state !== "confirmed" && step.state !== "adopted",
      );
      if (found.request.state !== "open" || next?.state !== "pending")
        return null;
      if (stopping) return "pantry_stopping";
      const version = await checkVersion();
      if (version) return version;
      const kind = next.kind as store.StepKind;
      let add: { product_id: number; stock_log_max: number } | undefined;
      if (kind === "stock_add") {
        const productId = resolved(plan, found.steps, "product");
        const product = await client.product(owner, productId);
        const location = await client.location(
          owner,
          resolved(plan, found.steps, "location"),
        );
        // Grocy 4.7.1 adds to a missing location, and a tare or unit change alters what the amount means.
        if (
          product?.status !== "ok" ||
          location?.status !== "ok" ||
          product.value.active !== 1 ||
          product.value.enable_tare_weight_handling === 1 ||
          product.value.qu_id_stock !== resolved(plan, found.steps, "unit") ||
          location.value.active !== 1
        )
          return "grocery_product_changed";
        const max = await client.stockLogMax(owner, productId);
        if (max?.status !== "ok") return "pantry_read_failed";
        add = { product_id: productId, stock_log_max: max.value };
      }
      const claim = store.claimGroceryStep(
        database,
        { request_id: found.request.id, number: next.number },
        clock,
        add,
      );
      if (!claim) return "grocery_step_not_claimable";
      const result = await send(plan, kind, found.steps);
      if (!store.finalizeGroceryStep(database, claim, result, clock))
        return "grocery_claim_lost";
      if (result?.status !== "confirmed")
        return result && "reason" in result ? result.reason : "uncertain";
      if (kind === "stock_add") queueRefresh();
    }
  }

  async function execute(
    userId: number,
    input: { mutation_id: string; plan: Plan },
  ) {
    const mutationId = input.mutation_id.toLowerCase();
    const text = canonical(input.plan);
    const hash = sha256(text);
    const known = store.readGrocery(database, userId, mutationId);
    if (known && known.request.plan_hash !== hash)
      throw new OperationError(409, "grocery_conflict");
    if (known && !["open", "binding_pending"].includes(known.request.state))
      return view(userId, mutationId);
    admit(userId);
    if (active)
      throw active.mutationId !== mutationId
        ? new OperationError(409, "grocery_busy")
        : active.hash === hash
          ? new OperationError(409, "grocery_in_progress")
          : new OperationError(409, "grocery_conflict");
    const admitted = { mutationId, hash };
    active = admitted;
    const work = (async () => {
      if (!known) {
        const {
          food_seen: _food,
          generation: _generation,
          restore_nonce: _nonce,
          binding_seen: _seen,
          overlaps: _overlaps,
          ...rest
        } = input.plan;
        const fresh = await propose(userId, rest);
        if (!fresh.plan || canonical(fresh.plan) !== text)
          throw new OperationError(409, "grocery_plan_changed");
        writeTransaction(database, (scope) =>
          store.insertGroceryRequest(
            scope,
            {
              ownerId,
              userId,
              mutationId,
              plan: text,
              restoreNonce: input.plan.restore_nonce,
              steps: fresh.steps,
              food:
                "food_id" in input.plan.food
                  ? input.plan.food
                  : { values: ownedFoodValues(input.plan.food.create) },
            },
            clock,
          ),
        );
      }
      return view(userId, mutationId, await run(mutationId, input.plan));
    })().finally(() => {
      if (active === admitted) active = null;
    });
    return track(work);
  }

  /** Every planned field of the object, or the whole purchase after the proved maximum, must match. */
  async function verify(
    plan: Plan,
    steps: Steps,
    number: number,
    proof: { object_id?: number; transaction_id?: string },
  ) {
    const target = steps.find((step) => step.number === number);
    if (target?.state !== "uncertain")
      throw new OperationError(409, "grocery_step_not_adoptable");
    const unitId = resolved(plan, steps, "unit");
    const locationId = resolved(plan, steps, "location");
    const productId = resolved(plan, steps, "product");
    const objectId = proof.object_id ?? 0;
    let matches = false;
    if (target.kind === "stock_add") {
      const rows = await maybe(
        client.transaction(owner, proof.transaction_id ?? ""),
      );
      matches =
        !!rows &&
        target.product_id === productId &&
        rows.every((row) => row.id > (target.stock_log_max ?? 0)) &&
        purchaseMatches(rows, productId, addOf(plan, locationId));
    } else if (target.kind === "unit" && "create" in plan.unit) {
      const unit = await maybe(client.unit(owner, objectId));
      matches =
        unit?.name === plan.unit.create.name &&
        unit.name_plural === plan.unit.create.name_plural;
    } else if (target.kind === "location" && "create" in plan.location) {
      const location = await maybe(client.location(owner, objectId));
      matches = location?.name === plan.location.create.name;
    } else if (target.kind === "product" && "create" in plan.product) {
      const product = await maybe(client.product(owner, objectId));
      matches =
        product?.name === plan.product.create.name &&
        product.location_id === locationId &&
        [
          product.qu_id_stock,
          product.qu_id_purchase,
          product.qu_id_consume,
          product.qu_id_price,
        ].every((unit) => unit === unitId) &&
        product.default_best_before_days === defaultDays(plan) &&
        product.min_stock_amount === 0 &&
        product.enable_tare_weight_handling === 0;
    } else if (target.kind === "barcode" && plan.barcode) {
      const barcode = await maybe(client.barcode(owner, objectId));
      matches =
        barcode?.product_id === productId &&
        barcode.barcode === plan.barcode.code &&
        barcode.qu_id === unitId &&
        barcode.amount === plan.barcode.amount;
    }
    if (!matches) throw new OperationError(409, "grocery_proof_mismatch");
    return target.kind === "stock_add"
      ? { transaction_id: proof.transaction_id ?? "", product_id: productId }
      : { object_id: objectId };
  }

  async function adopt(
    userId: number,
    input: {
      mutation_id: string;
      request_mutation_id: string;
      number: number;
      restore_nonce: string;
      object_id?: number;
      transaction_id?: string;
    },
  ) {
    if (
      (input.object_id === undefined) ===
      (input.transaction_id === undefined)
    )
      throw new OperationError(400, "grocery_proof_ambiguous");
    const found = store.readGrocery(
      database,
      userId,
      input.request_mutation_id,
    );
    if (!found) throw new OperationError(404, "grocery_not_found");
    const plan = groceryPlan.parse(JSON.parse(found.request.plan));
    // A recorded decision replays before any live check, as the store does.
    const decided = readDecision(database, {
      user_id: userId,
      mutation_id: input.mutation_id.toLowerCase(),
    });
    if (!decided) admit(userId);
    const proof = decided
      ? input.object_id !== undefined
        ? { object_id: input.object_id }
        : {
            transaction_id: input.transaction_id ?? "",
            product_id: resolved(plan, found.steps, "product"),
          }
      : await verify(plan, found.steps, input.number, input);
    const adopted = store.adoptGroceryStep(
      database,
      {
        ownerId,
        userId,
        mutationId: input.mutation_id,
        requestId: found.request.id,
        number: input.number,
        restoreNonce: input.restore_nonce,
        proof,
      },
      clock,
    );
    if (adopted.state === "binding_pending" && !adopted.replayed)
      queueRefresh();
    const stopped =
      found.request.user_id === ownerId
        ? bind(found.request.mutation_id)
        : null;
    return view(userId, input.request_mutation_id, stopped);
  }

  function abandon(
    userId: number,
    input: { mutation_id: string; request_mutation_id: string },
  ) {
    const found = store.readGrocery(
      database,
      userId,
      input.request_mutation_id,
    );
    if (!found) throw new OperationError(404, "grocery_not_found");
    store.abandonGrocery(
      database,
      {
        ownerId,
        userId,
        mutationId: input.mutation_id,
        requestId: found.request.id,
      },
      clock,
    );
    return view(userId, input.request_mutation_id);
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
    const ownConnection =
      !!config &&
      userId === ownerId &&
      !!row &&
      !row.reset_required &&
      row.user_id === found.request.user_id &&
      row.generation === found.request.generation &&
      row.url === found.request.url &&
      row.username === found.request.username;
    let candidates: z.output<typeof request>["candidates"] = null;
    if (ownConnection && add?.product_id && add.stock_log_max !== null) {
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
  return {
    propose: (userId: number, input: Input) => track(propose(userId, input)),
    status: (userId: number, mutationId?: string) =>
      track(status(userId, mutationId)),
    execute,
    adopt: (userId: number, input: Parameters<typeof adopt>[1]) =>
      track(adopt(userId, input)),
    abandon,
    /** Refuses new work, then waits for every send to record its result before the database closes. */
    stop() {
      stopping = true;
      return Promise.allSettled([...tracked]).then(() => {});
    },
  };
}
