import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "./support.mts";
import "./tsx.mts";

// The router's server build ignores navigation; this is the least browser it runs on.
process.env.NODE_ENV = "test";
const events = new EventTarget();
const listeners = {
  addEventListener: events.addEventListener.bind(events),
  removeEventListener: events.removeEventListener.bind(events),
};
Object.assign(globalThis, listeners, {
  window: globalThis,
  self: globalThis,
  history: {},
  scrollTo() {},
  document: listeners,
});
const { createMemoryHistory, Outlet, RouterProvider } = await import(
  "@tanstack/react-router"
);
const { BottomNav, createAppRouter, screenPaths } = await import(
  "../src/nav.tsx"
);

async function open(path: string, questions?: number) {
  const screens = Object.fromEntries(
    screenPaths.map((screen) => [screen, () => `screen ${screen}`]),
  );
  const layout = () =>
    createElement(
      "div",
      null,
      createElement(Outlet),
      createElement(BottomNav, { questions }),
    );
  const router = createAppRouter(
    layout,
    screens,
    createMemoryHistory({ initialEntries: [path] }),
  );
  await router.load();
  const html = () =>
    renderToStaticMarkup(createElement(RouterProvider, { router }));
  return { router, html };
}

const current = (html: string) =>
  [...html.matchAll(/<a[^>]*aria-current="page"[^>]*>.*?<\/a>/g)].map((match) =>
    match[0].replace(/<[^>]+>/g, ""),
  );

test("a tab URL opens that tab with only its tab marked current", async () => {
  for (const [path, label] of [
    ["/", "Today"],
    ["/questions", "Questions"],
    ["/add", "Add food"],
    ["/pantry", "Pantry"],
    ["/you", "You"],
  ] as const) {
    const { html } = await open(path);
    assert.match(html(), new RegExp(`screen ${path}<`));
    assert.deepEqual(current(html()), [label]);
  }
});

test("settings keeps You selected and unknown paths open Today", async () => {
  const settings = await open("/settings");
  assert.match(settings.html(), /screen \/settings</);
  assert.match(settings.html(), /<a [^>]*data-selected="true"[^>]*>.*?You</);
  const unknown = await open("/nowhere/at-all");
  assert.equal(unknown.router.state.location.pathname, "/");
  assert.deepEqual(current(unknown.html()), ["Today"]);
});

test("back returns to the previous tab", async () => {
  const { router, html } = await open("/questions");
  await router.navigate({ to: "/pantry" });
  assert.equal(router.state.location.pathname, "/pantry");
  router.history.back();
  await router.load();
  assert.deepEqual(current(html()), ["Questions"]);
});

test("the Questions tab shows the open count only when there is one", async () => {
  const badge = (html: string) =>
    /class="nav-badge"[^>]*>([^<]*)</.exec(html)?.[1];
  assert.equal(badge((await open("/", 3)).html()), "3");
  assert.equal(badge((await open("/", 0)).html()), undefined);
  assert.equal(badge((await open("/")).html()), undefined);
});
