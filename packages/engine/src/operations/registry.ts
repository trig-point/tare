import type { z as zod } from "zod";
import type { AuthEnv, Person } from "../auth/middleware.ts";
import type { AppOptions } from "../auth/routes.ts";
import { selectUser } from "../queries/select-user.ts";

export interface OperationIdentity {
  person?: Person;
  credential: AuthEnv["Variables"]["credential"];
  sessionToken?: string;
}

export interface OperationDependencies extends AppOptions {
  signInLimiter: { waiting: number };
}

export type OperationContext = OperationIdentity &
  OperationDependencies & {
    mode: AppOptions["config"]["identity"]["mode"];
  };
export function operationPerson(identity: OperationIdentity): Person {
  if (!identity.person) throw new OperationError(401, "unauthenticated");
  return identity.person;
}
export interface OperationResult {
  status: 200 | 201 | 204;
  body?: unknown;
  effects?: { setSessionCookie?: string; clearSessionCookie?: true };
}

export class OperationError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 500 | 503;
  readonly code: string;
  readonly headers: Record<string, string>;

  constructor(status: OperationError["status"], code: string, headers = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export interface Operation<Input extends zod.ZodType = zod.ZodType> {
  name: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  modes: ("access" | "fallback")[];
  callerClass: "public" | "browser" | "browser_and_agent";
  admin: boolean;
  bodyLimit?: number;
  noStoreSubpaths?: boolean;
  input: Input;
  inputError?: "not_found";
  output: zod.ZodType;
  handler(
    input: zod.output<Input>,
    context: OperationContext,
  ): OperationResult | Promise<OperationResult>;
}

export function defineOperation<Input extends zod.ZodType>(
  operation: Operation<Input>,
): Operation<Input> {
  if (
    operation.callerClass === "public" &&
    !(
      operation.name === "sign_in" &&
      operation.method === "POST" &&
      operation.path === "/api/session" &&
      operation.modes.length === 1 &&
      operation.modes[0] === "fallback"
    )
  )
    throw new Error("Only fallback sign-in may be public");
  if (operation.admin && operation.callerClass !== "browser")
    throw new Error("Administrator operations must be browser only");
  return operation;
}

export function authorizeCaller(
  operation: Operation,
  identity: OperationIdentity,
) {
  if (operation.callerClass === "public") return;
  if (!identity.person || identity.credential === undefined)
    throw new OperationError(401, "unauthenticated");
  if (
    !(
      identity.credential === "session" ||
      identity.credential === "access" ||
      (identity.credential === "service" &&
        operation.callerClass === "browser_and_agent")
    )
  )
    throw new OperationError(403, "forbidden");
}

export function authorizeOperation(
  operation: Operation,
  identity: OperationIdentity,
  deps: OperationDependencies,
) {
  authorizeCaller(operation, identity);
  if (!operation.modes.includes(deps.config.identity.mode))
    throw new OperationError(404, "not_found");
  if (
    operation.admin &&
    (!(identity.credential === "session" || identity.credential === "access") ||
      !identity.person ||
      !selectUser(deps.database, { id: identity.person.id })?.is_admin)
  )
    throw new OperationError(403, "forbidden");
}

export async function executeOperation(
  operation: Operation,
  rawInput: unknown,
  identity: OperationIdentity,
  deps: OperationDependencies,
): Promise<OperationResult> {
  authorizeOperation(operation, identity, deps);
  const input = operation.input.safeParse(rawInput);
  if (!input.success)
    throw new OperationError(
      operation.inputError === "not_found" ? 404 : 400,
      operation.inputError ?? "invalid_request",
    );
  const result = await operation.handler(input.data, {
    ...deps,
    ...identity,
    mode: deps.config.identity.mode,
  });
  if (result.status === 204) return { status: 204, effects: result.effects };
  const output = operation.output.safeParse(result.body);
  if (!output.success) {
    // Name only: the rejected body can hold private fields.
    console.error("operation_output_rejected", operation.name);
    throw new OperationError(500, "internal");
  }
  return { ...result, body: output.data };
}
