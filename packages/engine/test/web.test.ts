import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  accessConfig,
  assertionHeader,
  fixture,
  keySet,
  rejection,
  signAccessToken,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";

const webRoot = fileURLToPath(new URL("./fixtures/web/", import.meta.url));
test("web serves the built index and deep links with safe cache headers", async (context) => {
  const options = { webRoot, dummyHash: "unused" };
  const { app } = fixture(context, options);
  const html = await readFile(`${webRoot}/index.html`, "utf8");
  for (const path of ["/", "/history/day", "/index.html"]) {
    const response = await app.request(path, {
      headers: { Accept: "text/html" },
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), html);
    assert.equal(response.headers.get("Cache-Control"), "no-cache");
  }
  const asset = await app.request("/assets/app-example.js");
  assert.equal(asset.status, 200);
  assert.equal(
    asset.headers.get("Cache-Control"),
    "public, max-age=31536000, immutable",
  );
  assert.equal(
    (await app.request("/sw.js")).headers.get("Cache-Control"),
    "no-cache",
  );
  const head = await app.request("/history/day", {
    method: "HEAD",
    headers: { Accept: "text/html" },
  });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  for (const path of [
    "/missing.js",
    "/api/missing",
    "/api",
    "/mcp/missing",
    "/health/missing",
  ])
    await rejection(
      await app.request(path, { headers: { Accept: "text/html" } }),
      404,
      "not_found",
      false,
    );
  await rejection(await app.request("/history/day"), 404, "not_found", false);
  await rejection(
    await app.request("/history/day", {
      method: "POST",
      headers: { Accept: "text/html" },
    }),
    404,
    "not_found",
    false,
  );
  const missing = { ...options, webRoot: `${webRoot}/absent` };
  const absent = fixture(context, missing);
  await rejection(await absent.app.request("/"), 404, "not_found", false);
});

test("Access protects the shell before static serving", async (context) => {
  const options = { webRoot, config: accessConfig, accessKeySet: keySet };
  const setup = fixture(context, options);
  setup.database
    .prepare("UPDATE users SET access_email = ? WHERE id = ?")
    .run("admin@example.com", setup.admin.id);
  const { app } = setup;
  await rejection(await app.request("/"), 401, "unauthenticated", false);
  const response = await app.request("/", {
    headers: assertionHeader(await signAccessToken()),
  });
  assert.equal(response.status, 200);
  await response.text();
});
