import { agentTokenOperations } from "../auth/agent-tokens.ts";
import { authOperations } from "../auth/routes.ts";
import { dayReadOperations } from "../days/operations.ts";
import { daySignOffOperations } from "../days/sign-off.ts";
import { inboundTokenOperations } from "../inbound/tokens.ts";
import { loggingOperations } from "../logging/operations.ts";
import { lookupOperations } from "../lookup/operations.ts";
import { orderOperations } from "../orders/operations.ts";
import { planOperations } from "../plan/operations.ts";
import { profileOperations } from "../profile/operations.ts";
import { questionOperations } from "../questions/operations.ts";
import { regularMealOperations } from "../regular-meals/operations.ts";
import { signalOperations } from "../signals/operations.ts";
import { weightHistory } from "../trend/operations.ts";
import type { Operation } from "./registry.ts";

export const operations: Operation[] = [
  ...authOperations,
  ...agentTokenOperations,
  ...inboundTokenOperations,
  ...loggingOperations,
  ...dayReadOperations,
  ...daySignOffOperations,
  weightHistory,
  ...lookupOperations,
  ...questionOperations,
  ...signalOperations,
  ...orderOperations,
  ...profileOperations,
  ...regularMealOperations,
  ...planOperations,
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
