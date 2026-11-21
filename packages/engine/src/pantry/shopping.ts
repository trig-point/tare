import { z } from "zod";
import type { GrocyResult } from "../grocy/client.ts";
import type { GrocyConfig } from "../grocy/config.ts";
import { type createGroceryClient, findable } from "../grocy/grocery.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";

const identifier = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const store = z.strictObject({ id: identifier, name: z.string() });
const shoppingError = z.strictObject({
  reason: z.string(),
  http_status: z.number().int().optional(),
});
export const shoppingInput = z.strictObject({
  product_id: identifier,
  min_stock_amount: z.number().finite().min(0),
  store: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine(findable, "Unsupported characters")
    .nullable(),
});
export const shoppingSaved = z.strictObject({
  product_id: identifier,
  name: z.string(),
  min_stock_amount: z.number(),
  store: store.nullable(),
  store_created: z.boolean(),
});
export const shoppingList = z
  .strictObject({
    state: z.enum(["disabled", "unavailable", "ready"]),
    error: shoppingError.nullable(),
    stores: z.array(
      z.strictObject({
        store: store.nullable(),
        items: z.array(
          z.strictObject({
            id: identifier,
            product_id: identifier.nullable(),
            name: z.string(),
            amount: z.number(),
            unit: z.string().nullable(),
            done: z.boolean(),
          }),
        ),
      }),
    ),
  })
  .refine((result) => (result.state === "unavailable") === !!result.error);
type Client = Pick<
  ReturnType<typeof createGroceryClient>,
  | "requireSupportedVersion"
  | "shoppingProduct"
  | "shoppingProducts"
  | "units"
  | "shoppingLocations"
  | "shoppingLocationNamed"
  | "createShoppingLocation"
  | "setShopping"
  | "addMissingProducts"
  | "shoppingList"
>;
type ShoppingError = z.infer<typeof shoppingError>;
class GrocyFailed extends Error {
  readonly detail: ShoppingError;
  constructor(result: GrocyResult<unknown> | undefined) {
    super("Grocy call failed");
    this.detail =
      result && "reason" in result
        ? {
            reason: result.reason,
            ...(result.httpStatus === undefined
              ? {}
              : { http_status: result.httpStatus }),
          }
        : { reason: "response_withheld" };
  }
}
async function value<Value>(work: Promise<GrocyResult<Value> | undefined>) {
  const result = await work;
  if (result?.status === "ok" || result?.status === "confirmed")
    return result.value;
  throw new GrocyFailed(result);
}

export type ShoppingService = ReturnType<typeof createShoppingService>;

/** Grocy's own shopping list; Tare stores nothing about it. */
export function createShoppingService({
  config,
  ownerId,
  client,
}: {
  config: GrocyConfig | null;
  ownerId: number | null;
  client: Client;
}) {
  const owner = ownerId ?? 0;
  function authorize(userId: number) {
    if (!config || ownerId === null)
      throw new OperationError(503, "pantry_disabled");
    if (userId !== ownerId) throw new OperationError(403, "forbidden");
  }
  async function resolveStore(name: string) {
    const [found] = await value(client.shoppingLocationNamed(owner, name));
    if (found) return { store: found, created: false };
    const created = await client.createShoppingLocation(owner, name);
    if (created?.status === "confirmed")
      return { store: { id: created.value, name }, created: true };
    // Another writer created the same name first.
    if (created?.status !== "rejected") throw new GrocyFailed(created);
    const [raced] = await value(client.shoppingLocationNamed(owner, name));
    if (!raced) throw new GrocyFailed(created);
    return { store: raced, created: false };
  }

  async function save(userId: number, input: z.infer<typeof shoppingInput>) {
    authorize(userId);
    try {
      await value(client.requireSupportedVersion(owner));
      const product = await client.shoppingProduct(owner, input.product_id);
      if (product?.status === "failed" && product.reason === "not_found")
        throw new OperationError(404, "pantry_product_missing");
      await value(Promise.resolve(product));
      const chosen =
        input.store === null ? null : await resolveStore(input.store);
      const written = await client.setShopping(owner, input.product_id, {
        min_stock_amount: input.min_stock_amount,
        shopping_location_id: chosen?.store.id ?? null,
      });
      if (written?.status === "rejected")
        throw new OperationError(404, "pantry_product_missing");
      await value(Promise.resolve(written));
      const saved = await value(
        client.shoppingProduct(owner, input.product_id),
      );
      if (
        saved.min_stock_amount !== input.min_stock_amount ||
        saved.shopping_location_id !== (chosen?.store.id ?? null)
      )
        throw new OperationError(409, "pantry_product_changed");
      return shoppingSaved.parse({
        product_id: saved.id,
        name: saved.name,
        min_stock_amount: saved.min_stock_amount,
        store: chosen?.store ?? null,
        store_created: chosen?.created ?? false,
      });
    } catch (caught) {
      if (!(caught instanceof GrocyFailed)) throw caught;
      throw new OperationError(
        503,
        caught.detail.reason === "unsupported_version"
          ? "pantry_unsupported_version"
          : "pantry_unavailable",
      );
    }
  }

  async function refresh(userId: number) {
    if (!config) return { state: "disabled" as const, error: null, stores: [] };
    authorize(userId);
    try {
      await value(client.requireSupportedVersion(owner));
      await value(client.addMissingProducts(owner));
      const [items, products, units, stores] = await Promise.all([
        value(client.shoppingList(owner)),
        value(client.shoppingProducts(owner)),
        value(client.units(owner)),
        value(client.shoppingLocations(owner)),
      ]);
      const productById = new Map(products.map((row) => [row.id, row]));
      const unitById = new Map(units.map((row) => [row.id, row]));
      const storeById = new Map(stores.map((row) => [row.id, row]));
      const groups = new Map<
        number | null,
        z.infer<typeof shoppingList>["stores"][number]
      >();
      for (const item of items) {
        const product =
          item.product_id === null ? null : productById.get(item.product_id);
        if (product === undefined)
          throw new GrocyFailed({
            status: "failed",
            reason: "invalid_response",
          });
        const unit = item.qu_id === null ? undefined : unitById.get(item.qu_id);
        // A store Grocy no longer has lists its products under no store.
        const where = storeById.get(product?.shopping_location_id ?? 0) ?? null;
        const group = groups.get(where?.id ?? null) ?? {
          store: where,
          items: [],
        };
        groups.set(where?.id ?? null, group);
        group.items.push({
          id: item.id,
          product_id: item.product_id,
          name: product?.name ?? item.note ?? "",
          amount: item.amount,
          unit: unit
            ? item.amount === 1 || !unit.name_plural
              ? unit.name
              : unit.name_plural
            : null,
          done: item.done === 1,
        });
      }
      const sorted = [...groups.values()]
        .map((group) => ({
          ...group,
          items: group.items.sort((left, right) =>
            left.name.localeCompare(right.name),
          ),
        }))
        .sort((left, right) =>
          left.store === null
            ? 1
            : right.store === null
              ? -1
              : left.store.name.localeCompare(right.store.name),
        );
      return shoppingList.parse({
        state: "ready",
        error: null,
        stores: sorted,
      });
    } catch (caught) {
      if (!(caught instanceof GrocyFailed)) throw caught;
      return shoppingList.parse({
        state: "unavailable",
        error: caught.detail,
        stores: [],
      });
    }
  }
  return { save, refresh };
}

const service = (context: {
  shopping?: ShoppingService;
  config: { grocy: GrocyConfig | null };
}) => {
  if (context.shopping) return context.shopping;
  throw new OperationError(
    503,
    context.config.grocy ? "pantry_unavailable" : "pantry_disabled",
  );
};
const common = {
  method: "POST" as const,
  modes: ["access" as const, "fallback" as const],
  callerClass: "browser_and_agent" as const,
  admin: false,
  bodyLimit: 1024,
};

export const shoppingOperations = [
  defineOperation({
    ...common,
    name: "save_shopping_minimum",
    description:
      "Set a Grocy product's minimum stock and default store by name, creating the store if Grocy has none by that name. A null store clears it. Grocy lists the product to buy once stock drops below the minimum. Safe to repeat after a failure.",
    path: "/api/pantry/shopping/minimum",
    input: shoppingInput,
    output: shoppingSaved,
    async handler(input, context) {
      const userId = operationPerson(context).id;
      return { status: 200, body: await service(context).save(userId, input) };
    },
  }),
  defineOperation({
    ...common,
    name: "refresh_shopping_list",
    description:
      "Add products below their minimum stock to Grocy's shopping list, then read the list grouped by store. Items without a store come last under store null.",
    path: "/api/pantry/shopping",
    input: z.strictObject({}),
    output: shoppingList,
    async handler(_input, context) {
      const userId = operationPerson(context).id;
      if (!context.shopping && !context.config.grocy)
        return {
          status: 200,
          body: { state: "disabled", error: null, stores: [] },
        };
      return { status: 200, body: await service(context).refresh(userId) };
    },
  }),
];
