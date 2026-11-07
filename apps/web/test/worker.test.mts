import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { test } from "./support.mts";

test("built worker verifies its HTML and only caches built assets", async () => {
  const source = ts.createSourceFile(
    "sw.js",
    await readFile(new URL("../dist/sw.js", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const calls: ts.CallExpression[] = [];
  const navigation: ts.NewExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) calls.push(node);
    if (
      ts.isNewExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "NavigationRoute"
    )
      navigation.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const named = (name: string) =>
    calls.filter(
      (call) =>
        ts.isPropertyAccessExpression(call.expression) &&
        call.expression.name.text === name,
    );
  const precache = named("precacheAndRoute");
  assert.equal(precache.length, 1);
  const manifest = precache[0]?.arguments[0];
  assert.ok(manifest && ts.isArrayLiteralExpression(manifest));
  const entries = runInNewContext(`(${manifest.getText(source)})`) as {
    url: string;
    integrity?: string;
  }[];
  const html = entries.filter((entry) => entry.url.endsWith(".html"));
  assert.ok(html.length > 0);
  for (const entry of html)
    assert.equal(
      entry.integrity,
      `sha384-${createHash("sha384")
        .update(
          await readFile(new URL(`../dist/${entry.url}`, import.meta.url)),
        )
        .digest("base64")}`,
    );
  assert.equal(named("registerRoute").length, 1);
  assert.equal(navigation.length, 1);
  const options = navigation[0]?.arguments?.[1];
  assert.ok(options && ts.isObjectLiteralExpression(options));
  const { denylist } = runInNewContext(`(${options.getText(source)})`) as {
    denylist: RegExp[];
  };
  const denied = ["/api", "/mcp", "/health"];
  for (const path of denied.flatMap((path) => [
    path,
    `${path}/missing`,
    `${path}?check=1`,
  ]))
    assert.ok(
      denylist.some((rule) => rule.test(path)),
      path,
    );
  assert.ok(
    denylist.some((rule) => rule.test("/cdn-cgi/access/authorized?token=x")),
  );
  assert.ok(denylist.every((rule) => !rule.test("/history/day")));
  const fallback = named("createHandlerBoundToURL")[0]?.arguments[0];
  assert.ok(fallback && ts.isStringLiteral(fallback));
  assert.equal(fallback.text, "/index.html");
});
