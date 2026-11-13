import { z } from "zod";
import {
  defineOperation,
  type OperationContext,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import {
  type GroceryService,
  groceryInput,
  groceryProposal,
  groceryStatus,
} from "./flow.ts";

const operations: {
  name: string;
  path: string;
  description: string;
  input: z.ZodObject;
  output: z.ZodType;
  run(service: GroceryService, userId: number, input: never): unknown;
}[] = [
  {
    name: "propose_grocery",
    path: "/api/pantry/groceries/proposal",
    description:
      "Plan adding a grocery to Grocy: reuse or create the unit, location, product and optional barcode, then add the purchase in the product's stock unit and bind the food. Reads only. Show the plan to the person; it runs only after they confirm it.",
    input: groceryInput,
    output: groceryProposal,
    run: (service, userId, input: z.output<typeof groceryInput>) =>
      service.propose(userId, input),
  },
  {
    name: "read_grocery",
    path: "/api/pantry/groceries/status",
    description:
      "Read a grocery request's steps, or the open requests when mutation_id is omitted. An uncertain purchase lists candidate transaction ids; complete is false when some may be missing.",
    input: z.strictObject({ mutation_id: z.uuid().optional() }),
    output: groceryStatus,
    run: (service, userId, input: { mutation_id?: string }) =>
      service.status(userId, input.mutation_id),
  },
];

export const groceryOperations = operations.map((operation) =>
  defineOperation({
    name: operation.name,
    description: operation.description,
    method: "POST",
    path: operation.path,
    modes: ["access", "fallback"],
    callerClass: "browser_and_agent",
    admin: false,
    bodyLimit: 16_384,
    input: operation.input,
    output: operation.output,
    async handler(input, context: OperationContext) {
      const userId = operationPerson(context).id;
      if (!context.grocery)
        throw new OperationError(
          503,
          context.config.grocy ? "pantry_unavailable" : "pantry_disabled",
        );
      return {
        status: 200,
        body: await operation.run(context.grocery, userId, input as never),
      };
    },
  }),
);
