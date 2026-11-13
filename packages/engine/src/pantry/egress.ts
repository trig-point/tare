import { isIP } from "node:net";
import type { MiddlewareHandler } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import type { GrocyConfig } from "../grocy/config.ts";

const groceryOperations = [
  "propose_grocery",
  "read_grocery",
  "execute_grocery",
  "adopt_grocery_step",
  "abandon_grocery",
];
export const isGroceryOperation = (name: string) =>
  groceryOperations.includes(name);
export const isPantryOperation = (name: string) =>
  [
    ...groceryOperations,
    "list_pantry",
    "refresh_pantry",
    "reset_pantry_connection",
    "propose_pantry_binding",
    "save_pantry_binding",
    "delete_pantry_binding",
    "list_pantry_recipes",
    "save_recipe_nutrition_link",
    "delete_recipe_nutrition_link",
    "pantry_suggestion_context",
    "list_pantry_requests",
    "read_pantry_link",
    "list_pantry_products",
    "reconcile_pantry_request",
  ].includes(name);
export const isPantryPath = (path: string) =>
  path === "/api/pantry" || path.startsWith("/api/pantry/");
// Logging and planning responses can carry stock details, so they get the same outgoing checks as pantry reads.
const stockOperations = [
  "log_food",
  "log_regular_meal",
  "edit_intake",
  "delete_intake",
  "eat_meal",
  "planned_item_action",
  "plan_slot",
];
export const isGuardedOperation = (name: string) =>
  isPantryOperation(name) || stockOperations.includes(name);
const isGuardedPath = (path: string) =>
  isPantryPath(path) ||
  path === "/api/intake" ||
  path.startsWith("/api/intake/") ||
  [
    "/api/regular-meals/log",
    "/api/meals/eat",
    "/api/plan/items/action",
    "/api/plan/slot",
  ].includes(path);

/** Text forms of the private Grocy address; a single-label host only counts inside URL syntax. */
export function grocyLocators(url: string) {
  const parsed = new URL(url);
  const bare = parsed.hostname.replace(/^\[|\]$/g, "");
  const single = isIP(bare) === 0 && !bare.includes(".");
  return [
    parsed.origin,
    `//${parsed.host}`,
    ...(single
      ? [`//${bare}`, ...(parsed.port ? [`${bare}:${parsed.port}`] : [])]
      : [parsed.host, bare]),
  ].map((locator) => locator.toLowerCase());
}

export async function guardPantryResponse(
  response: Response,
  key: string,
  locators: string[] = [],
) {
  const escaped = JSON.stringify(key).slice(1, -1);
  const nested = JSON.stringify(escaped).slice(1, -1);
  const unsafe = (payload: string) =>
    [key, escaped, nested].some((secret) => payload.includes(secret)) ||
    locators.some((locator) => payload.toLowerCase().includes(locator));
  const headers = new Headers(response.headers);
  if (!response.body) return response;
  if (!headers.get("content-type")?.includes("text/event-stream")) {
    try {
      const payload = await response.text();
      if (!unsafe(payload))
        return new Response(payload, { status: response.status, headers });
    } catch {
      /* Refuse unreadable payloads. */
    }
    const payload = JSON.stringify({
      error: { code: "pantry_response_withheld" },
    });
    return new Response(unsafe(payload) ? null : payload, {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      },
    });
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffered = "";
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const boundary = buffered.indexOf("\n\n");
          if (boundary >= 0) {
            const frame = buffered.slice(0, boundary + 2);
            buffered = buffered.slice(boundary + 2);
            if (unsafe(frame)) {
              await reader.cancel();
              controller.close();
              return;
            }
            controller.enqueue(new TextEncoder().encode(frame));
            return;
          }
          const chunk = await reader.read();
          if (chunk.done) {
            buffered += decoder.decode();
            if (buffered && !unsafe(buffered))
              controller.enqueue(new TextEncoder().encode(buffered));
            controller.close();
            return;
          }
          buffered += decoder.decode(chunk.value, { stream: true });
          if (buffered.length > 2_000_000) {
            await reader.cancel();
            controller.close();
            return;
          }
        }
      } catch {
        const cancelled = await reader.cancel().then(
          () => true,
          () => false,
        );
        if (cancelled) controller.close();
        else controller.error();
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return new Response(body, { status: response.status, headers });
}

export function pantryEgress(
  config: GrocyConfig | null,
): MiddlewareHandler<AuthEnv> {
  return async (context, next) => {
    const key = config?.apiKey;
    let guarded = isGuardedPath(context.req.path);
    let grocery = context.req.path.startsWith("/api/pantry/groceries");
    if (key && context.req.path === "/mcp" && context.req.method === "POST") {
      const reader = context.req.raw.clone().body?.getReader();
      if (reader) {
        try {
          const chunks: Uint8Array[] = [];
          let size = 0;
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 65_536) {
              guarded = grocery = true;
              break;
            }
            chunks.push(chunk.value);
          }
          if (!guarded) {
            const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const requests = Array.isArray(request) ? request : [request];
            const called = requests
              .filter((request) => request?.method === "tools/call")
              .map((request) => request.params?.name);
            guarded = called.some(isGuardedOperation);
            grocery = called.some(isGroceryOperation);
          }
        } catch {
          guarded = grocery = true;
        } finally {
          void reader.cancel().catch(() => {
            guarded = true;
          });
        }
      }
    }
    await next();
    if (key && guarded) {
      try {
        context.res = await guardPantryResponse(
          context.res,
          key,
          grocery && config ? grocyLocators(config.url) : [],
        );
      } catch {
        context.res = new Response(null, {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        });
      }
    }
  };
}
