import { z as zod } from "zod";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import {
  recipeLinkInput,
  recipeLinkOutput,
  recipeLinkRemoval,
} from "./recipes.ts";
import {
  pantryRequestsOutput,
  reconcileInput,
  reconcileOutput,
} from "./reconcile.ts";
import {
  type PantryService,
  pantryBindingInput,
  pantryOutput,
  pantryProposal,
  pantryRecipesOutput,
  pantryReference,
} from "./service.ts";
import { pantrySuggestionContext } from "./suggestions.ts";

const disabled = {
  state: "disabled",
  generation: null,
  fetch_started_at: null,
  last_success_at: null,
  stale: true,
  error: null,
  products: [],
  bindings: [],
  requested: [],
};
const positiveId = zod.coerce
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const operations: {
  name: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  input: zod.ZodType;
  output: zod.ZodType;
  description?: string;
  callerClass?: "browser";
  disabled?: unknown;
  run(service: PantryService, userId: number, input: never): unknown;
}[] = [
  {
    name: "list_pantry",
    method: "GET",
    path: "/api/pantry",
    description:
      "Read pantry stock and bindings. A binding status comes from its save or the last complete refresh, whichever is later.",
    input: zod.strictObject({}),
    output: pantryOutput,
    disabled,
    run: (service, userId) => service.read(userId),
  },
  {
    name: "refresh_pantry",
    method: "POST",
    path: "/api/pantry/refresh",
    input: zod.strictObject({}),
    output: pantryOutput,
    disabled,
    run: (service, userId) => service.refresh(userId),
  },
  {
    name: "reset_pantry_connection",
    method: "POST",
    path: "/api/pantry/connection/reset",
    input: zod.strictObject({ replaced: zod.boolean().optional() }),
    output: pantryOutput,
    disabled,
    run: (service, userId, input: { replaced?: boolean }) =>
      service.reset(userId, input.replaced === true),
  },
  {
    name: "propose_pantry_binding",
    method: "POST",
    path: "/api/pantry/bindings/proposal",
    description:
      "Suggest a Grocy product for a source food by exact barcode. Saves nothing.",
    input: pantryReference,
    output: pantryProposal,
    disabled: { outcome: "disabled", proposal: null, error: null },
    run: (service, userId, input: zod.output<typeof pantryReference>) =>
      service.propose(userId, input),
  },
  {
    name: "save_pantry_binding",
    method: "POST",
    path: "/api/pantry/bindings",
    description:
      "Bind a food to a Grocy product with a quantity per serving in the product's stock unit.",
    input: pantryBindingInput,
    output: pantryOutput,
    run: (service, userId, input: zod.output<typeof pantryBindingInput>) =>
      service.save(userId, input),
  },
  {
    name: "delete_pantry_binding",
    method: "DELETE",
    path: "/api/pantry/bindings/:reference_kind/:reference_id",
    description: "Remove a food's pantry binding.",
    input: pantryReference.extend({
      reference_id: positiveId,
    }),
    output: pantryOutput,
    run: (service, userId, input: zod.output<typeof pantryReference>) =>
      service.remove(userId, input),
  },
  {
    name: "list_pantry_recipes",
    method: "GET",
    path: "/api/pantry/recipes",
    description:
      "Read Grocy recipes with stock fulfillment, missing amounts in Grocy's units and linked nutrition. Cooking a recipe never deducts stock automatically.",
    input: zod.strictObject({}),
    output: pantryRecipesOutput,
    disabled: {
      state: "disabled",
      generation: null,
      fetched_at: null,
      error: null,
      deducts_stock: false,
      recipes: [],
    },
    run: (service, userId) => service.recipes(userId),
  },
  {
    name: "save_recipe_nutrition_link",
    method: "POST",
    path: "/api/pantry/recipes/nutrition",
    description:
      "Link a Grocy recipe at its current servings to servings of a food, replacing any existing link.",
    input: recipeLinkInput,
    output: recipeLinkOutput,
    run: (service, userId, input: zod.output<typeof recipeLinkInput>) =>
      service.saveLink(userId, input),
  },
  {
    name: "delete_recipe_nutrition_link",
    method: "DELETE",
    path: "/api/pantry/recipes/:recipe_id/nutrition",
    description: "Remove a recipe's nutrition link.",
    input: zod.strictObject({ recipe_id: positiveId }),
    output: recipeLinkRemoval,
    disabled: { outcome: "disabled" },
    run: (service, userId, input: { recipe_id: number }) =>
      service.removeLink(userId, input.recipe_id),
  },
  {
    name: "read_pantry_link",
    method: "GET",
    path: "/api/pantry/link",
    callerClass: "browser",
    input: zod.strictObject({}),
    output: zod.strictObject({ url: zod.string().nullable() }),
    disabled: { url: null },
    run: (service, userId) => service.link(userId),
  },
  {
    name: "list_pantry_requests",
    method: "GET",
    path: "/api/pantry/requests",
    description:
      "Read Grocy stock requests that need attention and those resolved in the last 30 days, with attempts, decisions and retry timing.",
    input: zod.strictObject({}),
    output: pantryRequestsOutput,
    disabled: { state: "disabled", unresolved: [], history: [] },
    run: (service, userId) => service.requests(userId),
  },
  {
    name: "reconcile_pantry_request",
    method: "POST",
    path: "/api/pantry/requests/reconcile",
    description:
      "Record what happened to a stock request's current attempt: delivered, not delivered and retry, or abandoned. A pending request can only be abandoned. A rejected request can retry at once; an uncertain one waits 15 minutes after it became uncertain. Refetch the list for retry timing.",
    input: reconcileInput,
    output: reconcileOutput,
    run: (service, userId, input: zod.output<typeof reconcileInput>) =>
      service.reconcile(userId, input),
  },
];

export const pantryOperations = [
  ...operations.map((operation) =>
    defineOperation({
      name: operation.name,
      ...(operation.description ? { description: operation.description } : {}),
      method: operation.method,
      path: operation.path,
      modes: ["access", "fallback"],
      callerClass: operation.callerClass ?? "browser_and_agent",
      admin: false,
      ...(operation.method === "POST" ? { bodyLimit: 1024 } : {}),
      input: operation.input,
      output: operation.output,
      async handler(input, context) {
        const userId = operationPerson(context).id;
        const service = context.pantry;
        if (!service) {
          if (context.config.grocy || operation.disabled === undefined)
            throw new OperationError(
              503,
              context.config.grocy ? "pantry_unavailable" : "pantry_disabled",
            );
          return { status: 200, body: operation.disabled };
        }
        return {
          status: 200,
          body: await operation.run(service, userId, input as never),
        };
      },
    }),
  ),
  pantrySuggestionContext,
];
