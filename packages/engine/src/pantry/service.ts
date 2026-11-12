import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { z } from "zod";
import { scopeDatabase, writeTransaction } from "../db.ts";
import { createGrocyClient, type GrocyResult } from "../grocy/client.ts";
import type { GrocyConfig } from "../grocy/config.ts";
import { OperationError } from "../operations/registry.ts";
import { cancelPendingRequests } from "../queries/pantry/cancel-pending-requests.ts";
import { clearBindings } from "../queries/pantry/clear-bindings.ts";
import { clearProducts } from "../queries/pantry/clear-products.ts";
import { clearRecipeLinks } from "../queries/pantry/clear-recipe-links.ts";
import { countUnresolvedRequests } from "../queries/pantry/count-unresolved-requests.ts";
import { deleteBinding } from "../queries/pantry/delete-binding.ts";
import { deleteRecipeLink } from "../queries/pantry/delete-recipe-link.ts";
import { insertProduct } from "../queries/pantry/insert-product.ts";
import { listBindings } from "../queries/pantry/list-bindings.ts";
import { listProducts } from "../queries/pantry/list-products.ts";
import { listRecipeLinks } from "../queries/pantry/list-recipe-links.ts";
import { readBinding } from "../queries/pantry/read-binding.ts";
import { readConnection } from "../queries/pantry/read-connection.ts";
import { requestTotals } from "../queries/pantry/request-totals.ts";
import { saveBinding } from "../queries/pantry/save-binding.ts";
import { saveConnection } from "../queries/pantry/save-connection.ts";
import { saveRecipeLink } from "../queries/pantry/save-recipe-link.ts";
import { updateBindingStatus } from "../queries/pantry/update-binding-status.ts";
import { selectFood } from "../queries/select-food.ts";
import { selectSourceFood } from "../queries/select-source-food.ts";
import {
  assembleRecipes,
  pantryRecipe,
  type recipeLinkInput,
  recipeNutrition,
} from "./recipes.ts";
import { createReconciliation, type reconcileInput } from "./reconcile.ts";

const identifier = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const pantryProduct = z.strictObject({
  product_id: identifier,
  name: z.string().min(1),
  amount: z.number().finite(),
  stock_unit: z.strictObject({
    id: identifier,
    name: z.string().min(1),
    name_plural: z.string().nullable(),
  }),
  best_before_date: z.string().nullable(),
  grams: z.null(),
});
const pantryError = z.strictObject({
  reason: z.enum([
    "disabled",
    "not_owner",
    "invalid_input",
    "unauthorized",
    "not_found",
    "http",
    "invalid_response",
    "transport",
    "timeout",
    "too_large",
    "response_withheld",
  ]),
  http_status: z.number().int().optional(),
});
export const pantryReference = z.strictObject({
  reference_kind: z.enum(["food", "source_food"]),
  reference_id: identifier,
});
const bindingStatus = z.enum([
  "valid",
  "product_missing",
  "unit_mismatch",
  "tare_enabled",
]);
export const pantryBindingInput = pantryReference.extend({
  product_id: identifier,
  stock_unit_id: identifier,
  quantity_per_serving: z.number().positive().finite(),
  expected_generation: identifier,
});
const pantryBinding = pantryReference.extend({
  product_id: identifier,
  stock_unit_id: identifier,
  quantity_per_serving: z.number().positive().finite(),
  status: bindingStatus,
});
const proposalOutcome = z.enum([
  "proposal",
  "disabled",
  "reset_required",
  "unsupported",
  "no_barcode",
  "no_match",
  "ambiguous",
  "tare_enabled",
  "failed",
]);
// MCP output schemas must be objects, so the outcome rules are refinements.
export const pantryProposal = z
  .strictObject({
    outcome: proposalOutcome,
    proposal: z
      .strictObject({
        generation: identifier,
        product_id: identifier,
        name: z.string().min(1),
        stock_unit: pantryProduct.shape.stock_unit,
      })
      .nullable(),
    error: pantryError.nullable(),
  })
  .refine(
    (result) =>
      (result.outcome === "proposal") === (result.proposal !== null) &&
      (result.outcome === "failed") === (result.error !== null),
  );
const requestedAmount = z.strictObject({
  product_id: identifier,
  stock_unit_id: identifier,
  pending: z.number().finite().nonnegative(),
  sending: z.number().finite().nonnegative(),
  uncertain: z.number().finite().nonnegative(),
});
export const pantryOutput = z.strictObject({
  state: z.enum(["disabled", "reset_required", "never_refreshed", "ready"]),
  generation: z.number().nullable(),
  fetch_started_at: z.string().nullable(),
  last_success_at: z.string().nullable(),
  stale: z.boolean(),
  error: pantryError.nullable(),
  products: z.array(pantryProduct),
  bindings: z.array(pantryBinding),
  requested: z.array(requestedAmount),
});
export const pantryRecipesOutput = z
  .strictObject({
    state: z.enum(["disabled", "reset_required", "unavailable", "ready"]),
    generation: z.number().nullable(),
    fetched_at: z.string().nullable(),
    error: pantryError.nullable(),
    deducts_stock: z.literal(false),
    recipes: z.array(pantryRecipe),
  })
  .refine((result) => (result.state === "unavailable") === !!result.error);
type Product = z.infer<typeof pantryProduct>;
type PantryError = z.infer<typeof pantryError>;
type Reference = z.infer<typeof pantryReference>;
type Proposal = z.infer<typeof pantryProposal>;
const outcome = (
  value: z.infer<typeof proposalOutcome>,
  error: PantryError | null = null,
): Proposal => ({ outcome: value, proposal: null, error });
class ReadFailure extends Error {
  readonly detail: PantryError;
  constructor(detail: PantryError) {
    super("Pantry read failed");
    this.detail = detail;
  }
}
function ok<Value>(result: GrocyResult<Value> | undefined): Value {
  if (result?.status === "ok") return result.value;
  throw new ReadFailure(
    pantryError.parse({
      reason:
        result && "reason" in result ? result.reason : "response_withheld",
      ...(result && "httpStatus" in result && result.httpStatus !== undefined
        ? { http_status: result.httpStatus }
        : {}),
    }),
  );
}
export type PantryService = ReturnType<typeof createPantryService>;

export function createPantryService({
  database,
  config,
  ownerId,
  clock,
  client = createGrocyClient({ config, ownerId }),
  dispatch,
  report = () => {},
}: {
  database: Database;
  config: GrocyConfig | null;
  ownerId: number | null;
  clock: { now(): Date };
  dispatch?: {
    kick(): void;
    holds(requestId: string, number: number): boolean;
  };
  report?: (code: string) => void;
  client?: Pick<
    ReturnType<typeof createGrocyClient>,
    | "stock"
    | "product"
    | "catalog"
    | "barcodes"
    | "recipes"
    | "recipePositions"
    | "fulfillment"
    | "units"
    | "conversions"
  >;
}) {
  let stopping = false;
  const owner = ownerId ?? 0;
  const tracked = new Set<Promise<unknown>>();
  function track<Value>(work: Promise<Value>) {
    tracked.add(work);
    const release = () => tracked.delete(work);
    work.then(release, release);
    return work;
  }
  let slot: { generation: number; work: Promise<void> } | undefined;
  const matches = (row: NonNullable<ReturnType<typeof readConnection>>) =>
    row.url === config?.url &&
    row.username === config.username &&
    row.user_id === ownerId;
  const initial = (generation: number) => {
    if (!config || ownerId === null) throw new Error("Pantry owner missing");
    return {
      generation,
      url: config.url,
      username: config.username,
      user_id: ownerId,
      reset_required: 0,
      fetch_started_at: null,
      last_success_at: null,
      error: null,
    };
  };
  if (config)
    writeTransaction(database, (scope) => {
      const database = scopeDatabase(scope);
      const row = readConnection(database);
      if (!row) saveConnection(database, initial(1));
      else if (!matches(row))
        saveConnection(database, { ...row, reset_required: 1 });
    });
  function authorize(userId: number) {
    if (config && userId !== ownerId)
      throw new OperationError(403, "forbidden");
    if (stopping) throw new OperationError(503, "pantry_stopping");
  }
  function read(userId: number) {
    authorize(userId);
    const empty = {
      generation: null,
      fetch_started_at: null,
      last_success_at: null,
      stale: true,
      error: null,
      products: [],
      bindings: [],
      requested: [],
    };
    if (!config) return pantryOutput.parse({ ...empty, state: "disabled" });
    const row = readConnection(database);
    if (!row) throw new Error("Pantry connection missing");
    if (row.reset_required)
      return pantryOutput.parse({
        ...empty,
        state: "reset_required",
        generation: row.generation,
      });
    return pantryOutput.parse({
      state: row.last_success_at === null ? "never_refreshed" : "ready",
      generation: row.generation,
      fetch_started_at: row.fetch_started_at,
      last_success_at: row.last_success_at,
      stale:
        row.fetch_started_at === null ||
        clock.now().getTime() - Date.parse(row.fetch_started_at) > 600_000,
      error: row.error === null ? null : JSON.parse(row.error),
      products: listProducts(database, {
        user_id: userId,
        generation: row.generation,
      }).map((row) => JSON.parse(row.product)),
      bindings: listBindings(database, {
        user_id: userId,
        generation: row.generation,
      }).map(({ change_token: _token, ...binding }) => binding),
      requested: requestTotals(database, {
        user_id: userId,
        generation: row.generation,
      }),
    });
  }
  function current(generation: number) {
    if (stopping) return false;
    const row = readConnection(database);
    return (
      !!row &&
      !row.reset_required &&
      row.generation === generation &&
      matches(row)
    );
  }
  function ensure(generation: number) {
    if (stopping) throw new OperationError(503, "pantry_stopping");
    if (!current(generation))
      throw new OperationError(409, "pantry_generation_changed");
  }
  async function recipes(userId: number) {
    authorize(userId);
    const empty = {
      generation: null,
      fetched_at: null,
      error: null,
      deducts_stock: false,
      recipes: [],
    };
    if (!config)
      return pantryRecipesOutput.parse({ ...empty, state: "disabled" });
    const row = readConnection(database);
    if (!row) throw new Error("Pantry connection missing");
    const { generation } = row;
    if (row.reset_required)
      return pantryRecipesOutput.parse({
        ...empty,
        state: "reset_required",
        generation,
      });
    ensure(generation);
    const fetchedAt = clock.now().toISOString();
    const settled = async <Value>(
      work: Promise<GrocyResult<Value> | undefined>,
    ) => {
      const value = ok(await work);
      ensure(generation);
      return value;
    };
    let assembled: ReturnType<typeof assembleRecipes> = null;
    let error: PantryError = { reason: "invalid_response" };
    try {
      assembled = assembleRecipes({
        recipes: await settled(client.recipes(owner)),
        positions: await settled(client.recipePositions(owner)),
        products: await settled(client.catalog(owner)),
        fulfillment: await settled(client.fulfillment(owner)),
        units: await settled(client.units(owner)),
        conversions: await settled(client.conversions(owner)),
      });
    } catch (caught) {
      if (!(caught instanceof ReadFailure)) throw caught;
      error = caught.detail;
    }
    ensure(generation);
    if (!assembled)
      return pantryRecipesOutput.parse({
        ...empty,
        state: "unavailable",
        generation,
        fetched_at: fetchedAt,
        error,
      });
    const links = new Map(
      listRecipeLinks(database, { user_id: userId, generation }).map((row) => [
        row.recipe_id,
        row,
      ]),
    );
    return pantryRecipesOutput.parse({
      ...empty,
      state: "ready",
      generation,
      fetched_at: fetchedAt,
      recipes: assembled.map((recipe) => {
        const saved = links.get(recipe.recipe_id);
        const food =
          saved &&
          (saved.reference_kind === "food"
            ? selectFood(database, { user_id: userId, id: saved.reference_id })
            : selectSourceFood(database, { id: saved.reference_id }));
        return {
          ...recipe,
          nutrition: recipeNutrition(
            saved,
            recipe.desired_servings,
            food ?? null,
          ),
        };
      }),
    });
  }
  async function saveLink(
    userId: number,
    input: z.infer<typeof recipeLinkInput>,
  ) {
    authorize(userId);
    const { generation } = connection();
    if (!referenced(database, userId, input))
      throw new OperationError(404, "food_not_found");
    const catalog = await client.recipes(owner);
    ensure(generation);
    let desiredServings: number | null | undefined;
    try {
      desiredServings = ok(catalog).find(
        (recipe) => recipe.id === input.recipe_id && recipe.type === "normal",
      )?.desired_servings;
    } catch {
      throw new OperationError(503, "pantry_read_failed");
    }
    if (desiredServings === undefined)
      throw new OperationError(404, "pantry_recipe_missing");
    if (desiredServings === null || !(desiredServings > 0))
      throw new OperationError(409, "pantry_recipe_servings_invalid");
    const link = {
      reference_kind: input.reference_kind,
      reference_id: input.reference_id,
      servings: input.servings,
      desired_servings_at_link: desiredServings,
    };
    writeTransaction(database, (scope) => {
      const database = scopeDatabase(scope);
      ensure(generation);
      if (!referenced(database, userId, input))
        throw new OperationError(404, "food_not_found");
      saveRecipeLink(database, {
        ...link,
        user_id: userId,
        generation,
        recipe_id: input.recipe_id,
      });
    });
    return { recipe_id: input.recipe_id, link };
  }
  async function activeProducts() {
    return new Set(
      ok(await client.catalog(owner))
        .filter((product) => product.active === 1)
        .map((product) => product.id),
    );
  }
  async function detail(productId: number) {
    const value = ok(await client.product(owner, productId));
    if (
      value.product.id !== productId ||
      value.product.qu_id_stock !== value.quantity_unit_stock.id
    )
      throw new Error("Invalid unit");
    return value;
  }
  async function attempt(generation: number) {
    const started = clock.now().toISOString();
    const products: Product[] = [];
    const bindings = listBindings(database, { user_id: owner, generation });
    const statuses: [
      (typeof bindings)[number],
      z.infer<typeof bindingStatus>,
    ][] = [];
    let error: PantryError | null = null;
    try {
      if (!current(generation)) return;
      const stock = ok(await client.stock(owner));
      const active = await activeProducts();
      const seen = new Set<number>();
      for (const item of stock) {
        identifier.parse(item.product_id);
        if (seen.has(item.product_id) || item.product.id !== item.product_id)
          throw new Error("Invalid stock");
        seen.add(item.product_id);
      }
      const details = new Map<number, Awaited<ReturnType<typeof detail>>>();
      const units = new Map<number, string>();
      for (const productId of new Set([
        ...seen,
        ...bindings.map((binding) => binding.product_id),
      ])) {
        if (!active.has(productId)) continue;
        if (!current(generation)) return;
        const value = await detail(productId);
        const unit = value.quantity_unit_stock;
        const metadata = JSON.stringify(unit);
        if (units.has(unit.id) && units.get(unit.id) !== metadata)
          throw new Error("Inconsistent unit");
        units.set(unit.id, metadata);
        details.set(productId, value);
      }
      for (const item of stock) {
        const value = details.get(item.product_id);
        if (!value) continue;
        if (item.product.qu_id_stock !== value.quantity_unit_stock.id)
          throw new Error("Invalid unit");
        products.push(
          pantryProduct.parse({
            product_id: item.product_id,
            name: value.product.name,
            amount: item.amount,
            stock_unit: value.quantity_unit_stock,
            best_before_date: item.best_before_date,
            grams: null,
          }),
        );
      }
      for (const binding of bindings) {
        const value = details.get(binding.product_id);
        statuses.push([
          binding,
          !value
            ? "product_missing"
            : value.product.enable_tare_weight_handling === 1
              ? "tare_enabled"
              : value.quantity_unit_stock.id !== binding.stock_unit_id
                ? "unit_mismatch"
                : "valid",
        ]);
      }
    } catch (caught) {
      error =
        caught instanceof ReadFailure
          ? caught.detail
          : { reason: "invalid_response" };
    }
    const serializedError = error === null ? null : JSON.stringify(error);
    const fallback = JSON.stringify({ reason: "response_withheld" });
    const containsKey = (text: string) =>
      config !== null && text.includes(config.apiKey);
    const storedError =
      serializedError !== null && containsKey(serializedError)
        ? containsKey(fallback)
          ? null
          : fallback
        : serializedError;
    writeTransaction(database, (scope) => {
      if (!current(generation)) return;
      const database = scopeDatabase(scope);
      const row = readConnection(database);
      if (!row) throw new Error("Pantry connection missing");
      if (error) saveConnection(database, { ...row, error: storedError });
      else {
        clearProducts(database);
        for (const product of products)
          insertProduct(database, {
            user_id: row.user_id,
            generation,
            product_id: product.product_id,
            product: JSON.stringify(product),
          });
        // The token match leaves bindings saved or replaced during the fetch alone.
        for (const [binding, status] of statuses)
          updateBindingStatus(
            database,
            { status },
            {
              ...binding,
              user_id: owner,
              generation,
            },
          );
        saveConnection(database, {
          ...row,
          fetch_started_at: started,
          last_success_at: clock.now().toISOString(),
          error: null,
        });
      }
    });
    if (error && storedError === null && current(generation))
      throw new OperationError(503, "");
  }
  async function refresh(userId: number) {
    authorize(userId);
    if (!config) return read(userId);
    const admitted = readConnection(database);
    if (!admitted) throw new Error("Pantry connection missing");
    if (admitted.reset_required) return read(userId);
    while (slot && slot.generation !== admitted.generation) {
      // Only the current generation may fail its caller; this slot is obsolete.
      await Promise.allSettled([slot.work]);
      authorize(userId);
      if (!current(admitted.generation)) return read(userId);
    }
    if (!slot && current(admitted.generation)) {
      const work = Promise.resolve().then(() => attempt(admitted.generation));
      const occupied = { generation: admitted.generation, work };
      slot = occupied;
      const release = () => {
        if (slot === occupied) slot = undefined;
      };
      work.then(release, release);
    }
    await slot?.work;
    return read(userId);
  }
  let followUp: Promise<ReturnType<typeof read> | undefined> | undefined;
  /** Refreshes with a fetch that starts after this call, so a delivered consume shows in the snapshot. */
  function refreshAfterDelivery() {
    if (stopping) return Promise.resolve(undefined);
    // A queued flight has not started fetching yet, so it already covers this call.
    if (followUp) return followUp;
    const queued = Promise.resolve().then(async () => {
      while (slot) await Promise.allSettled([slot.work]);
      if (followUp === queued) followUp = undefined;
      if (stopping) return undefined;
      // A stop that lands mid-refresh is shutdown, not a failed refresh.
      return refresh(owner).catch((caught: unknown) => {
        if (stopping) return undefined;
        throw caught;
      });
    });
    followUp = queued;
    return track(queued);
  }
  function connection() {
    if (!config) throw new OperationError(503, "pantry_disabled");
    const row = readConnection(database);
    if (!row) throw new Error("Pantry connection missing");
    if (row.reset_required)
      throw new OperationError(503, "pantry_reset_required");
    return row;
  }
  function referenced(database: Database, userId: number, ref: Reference) {
    return ref.reference_kind === "food"
      ? selectFood(database, { user_id: userId, id: ref.reference_id }) !== null
      : selectSourceFood(database, { id: ref.reference_id }) !== null;
  }
  async function propose(userId: number, ref: Reference): Promise<Proposal> {
    authorize(userId);
    if (!config) return outcome("disabled");
    const row = readConnection(database);
    if (!row) throw new Error("Pantry connection missing");
    if (row.reset_required) return outcome("reset_required");
    if (!referenced(database, userId, ref))
      throw new OperationError(404, "food_not_found");
    if (ref.reference_kind === "food") return outcome("unsupported");
    const barcode = selectSourceFood(database, {
      id: ref.reference_id,
    })?.barcode;
    if (!barcode) return outcome("no_barcode");
    try {
      const rows = ok(await client.barcodes(owner));
      const active = await activeProducts();
      const candidates = new Set(
        rows
          .filter(
            (row) => row.barcode === barcode && active.has(row.product_id),
          )
          .map((row) => row.product_id),
      );
      if (candidates.size !== 1)
        return outcome(candidates.size ? "ambiguous" : "no_match");
      const [productId] = candidates;
      const value = await detail(productId as number);
      if (value.product.enable_tare_weight_handling === 1)
        return outcome("tare_enabled");
      return {
        outcome: "proposal",
        proposal: {
          generation: row.generation,
          product_id: value.product.id,
          name: value.product.name,
          stock_unit: value.quantity_unit_stock,
        },
        error: null,
      };
    } catch (caught) {
      return outcome(
        "failed",
        caught instanceof ReadFailure
          ? caught.detail
          : { reason: "invalid_response" },
      );
    }
  }
  async function save(
    userId: number,
    input: z.infer<typeof pantryBindingInput>,
  ) {
    authorize(userId);
    const { generation } = connection();
    if (input.expected_generation !== generation)
      throw new OperationError(409, "pantry_generation_changed");
    const key = {
      user_id: userId,
      generation,
      reference_kind: input.reference_kind,
      reference_id: input.reference_id,
    };
    const check = (database: Database) => {
      if (!referenced(database, userId, input))
        throw new OperationError(404, "food_not_found");
      const [existing] = readBinding(database, key);
      if (existing && existing.product_id !== input.product_id)
        throw new OperationError(409, "pantry_binding_conflict");
    };
    check(database);
    let value: Awaited<ReturnType<typeof detail>>;
    try {
      if (!(await activeProducts()).has(input.product_id))
        throw new OperationError(404, "pantry_product_missing");
      value = await detail(input.product_id);
    } catch (caught) {
      if (caught instanceof OperationError) throw caught;
      throw new OperationError(503, "pantry_read_failed");
    }
    if (value.product.enable_tare_weight_handling === 1)
      throw new OperationError(400, "pantry_tare_weight");
    if (value.quantity_unit_stock.id !== input.stock_unit_id)
      throw new OperationError(409, "pantry_unit_changed");
    writeTransaction(database, (scope) => {
      const database = scopeDatabase(scope);
      if (!current(generation))
        throw stopping
          ? new OperationError(503, "pantry_stopping")
          : new OperationError(409, "pantry_generation_changed");
      check(database);
      saveBinding(database, {
        ...key,
        product_id: input.product_id,
        stock_unit_id: input.stock_unit_id,
        quantity_per_serving: input.quantity_per_serving,
        change_token: randomUUID(),
      });
    });
    return read(userId);
  }
  const reconciliation = createReconciliation({
    database,
    ownerId: owner,
    clock,
    stopping: () => stopping,
    dispatch,
    refresh: refreshAfterDelivery,
    report,
  });
  return {
    read,
    refresh,
    refreshAfterDelivery,
    requests(userId: number) {
      authorize(userId);
      if (!config)
        return { state: "disabled" as const, unresolved: [], history: [] };
      return reconciliation.list();
    },
    reconcile(userId: number, input: z.output<typeof reconcileInput>) {
      if (!config) throw new OperationError(503, "pantry_disabled");
      // Replaying a recorded decision must work while stopping, so only ownership is checked here.
      if (userId !== ownerId) throw new OperationError(403, "forbidden");
      return reconciliation.decide(userId, input);
    },
    recipes: (userId: number) => track(recipes(userId)),
    saveLink: (userId: number, input: z.infer<typeof recipeLinkInput>) =>
      track(saveLink(userId, input)),
    removeLink(userId: number, recipeId: number) {
      authorize(userId);
      if (!config) return { outcome: "disabled" as const };
      const row = readConnection(database);
      if (!row) throw new Error("Pantry connection missing");
      if (row.reset_required) return { outcome: "reset_required" as const };
      const { changes } = writeTransaction(database, (scope) =>
        deleteRecipeLink(scopeDatabase(scope), {
          user_id: userId,
          generation: row.generation,
          recipe_id: recipeId,
        }),
      );
      return {
        outcome: changes ? ("deleted" as const) : ("not_found" as const),
      };
    },
    propose: (userId: number, ref: Reference) => track(propose(userId, ref)),
    save: (userId: number, input: z.infer<typeof pantryBindingInput>) =>
      track(save(userId, input)),
    remove(userId: number, ref: Reference) {
      authorize(userId);
      const { generation } = connection();
      writeTransaction(database, (scope) =>
        deleteBinding(scopeDatabase(scope), {
          ...ref,
          user_id: userId,
          generation,
        }),
      );
      return read(userId);
    },
    reset(userId: number, replaced = false) {
      authorize(userId);
      if (!config) return read(userId);
      const refused = writeTransaction(database, (scope) => {
        const database = scopeDatabase(scope);
        const row = readConnection(database);
        if (!row) throw new Error("Pantry connection missing");
        if (!replaced && !row.reset_required && matches(row)) return false;
        // Requests from any owner or generation may have reached Grocy, so all of them block.
        if (countUnresolvedRequests(database)?.unresolved) {
          if (replaced) saveConnection(database, { ...row, reset_required: 1 });
          return true;
        }
        const now = clock.now().toISOString();
        cancelPendingRequests(database, { resolved_at: now, updated_at: now });
        clearProducts(database);
        clearBindings(database);
        clearRecipeLinks(database);
        saveConnection(database, initial(row.generation + 1));
        return false;
      });
      if (refused) throw new OperationError(409, "pantry_requests_unresolved");
      return read(userId);
    },
    stop() {
      stopping = true;
      return Promise.allSettled([slot?.work, ...tracked]).then(() => {});
    },
    job: {
      name: "pantry-refresh",
      schedule: "*/5 * * * *",
      async run() {
        const result = await refresh(ownerId ?? 0);
        if (result.error || result.state === "reset_required")
          throw new Error("");
        // Empty job details cannot collide with a configured credential.
        return "";
      },
    },
  };
}
