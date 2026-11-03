import { agentTokenOperations } from "../auth/agent-tokens.ts";
import { authOperations } from "../auth/routes.ts";
import { loggingOperations } from "../logging/operations.ts";
import type { Operation } from "./registry.ts";

export const operations: Operation[] = [
  ...authOperations,
  ...agentTokenOperations,
  ...loggingOperations,
];
export const agentOperations = operations.filter(
  (operation) => operation.callerClass === "browser_and_agent",
);

export function agentOperationsFor(mode: "access" | "fallback") {
  return operations.filter(
    (operation) =>
      operation.callerClass === "browser_and_agent" &&
      operation.modes.includes(mode),
  );
}
