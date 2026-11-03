import { existsSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import type { AuthEnv } from "./auth/middleware.ts";

export function mountWeb(app: Hono<AuthEnv>, root?: string) {
  if (root === undefined) return;
  if (!isAbsolute(root)) throw new Error("Web asset root must be absolute");
  if (!existsSync(join(root, "index.html"))) {
    console.warn("Web assets not found; serving the API only");
    return;
  }
  const assets = serveStatic<AuthEnv>({ root });
  const index = serveStatic<AuthEnv>({ path: join(root, "index.html") });
  app.use("*", async (context, next) => {
    const path = context.req.path;
    if (/^\/(?:api|mcp|health)(?:\/|$)/.test(path)) return context.notFound();
    const response = await assets(context, next);
    if (response instanceof Response)
      response.headers.set(
        "Cache-Control",
        path.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      );
    return response;
  });
  app.use("*", (context, next) => {
    if (
      (context.req.method === "GET" || context.req.method === "HEAD") &&
      context.req.header("Accept")?.includes("text/html") &&
      extname(context.req.path) === ""
    ) {
      context.header("Cache-Control", "no-cache");
      return index(context, next);
    }
    return next();
  });
}
