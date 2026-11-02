import { agentTokenOperations } from "../auth/agent-tokens.ts";
import { authOperations } from "../auth/routes.ts";
import type { Operation } from "./registry.ts";

export const operations: Operation[] = [
  ...authOperations,
  ...agentTokenOperations,
];
export const agentOperations = operations.filter(
  (operation) => operation.callerClass === "browser_and_agent",
);
