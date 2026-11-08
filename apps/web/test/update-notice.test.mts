import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "./support.mts";
import "./tsx.mts";

const reloads: string[] = [];
const pwa = {
  needRefresh: [false],
  updateServiceWorker: async () => void reloads.push("reload"),
};
let options: {
  onRegisteredSW: (url: string, registration: { update: () => void }) => void;
};
Object.assign(globalThis, {
  registerStub: (given: typeof options) => {
    options = given;
    return pwa;
  },
});
const { UpdateNotice } = await import("../src/update-notice.tsx");

test("a waiting version shows Update ready, and Reload activates it", () => {
  assert.equal(UpdateNotice(), null);
  pwa.needRefresh = [true];
  const notice = UpdateNotice();
  assert.equal(
    renderToStaticMarkup(notice),
    '<output class="update-notice">Update ready<button type="button">Reload</button></output>',
  );
  notice?.props.children[1].props.onClick();
  assert.deepEqual(reloads, ["reload"]);
});

test("a page that becomes visible asks the browser to check for a new version", () => {
  const listeners: Record<string, () => void> = {};
  const page = {
    visibilityState: "hidden",
    addEventListener: (type: string, listener: () => void) => {
      listeners[type] = listener;
    },
  };
  Object.assign(globalThis, { document: page });
  const checks: string[] = [];
  UpdateNotice();
  options.onRegisteredSW("/sw.js", { update: () => void checks.push("check") });
  listeners.visibilitychange?.();
  assert.deepEqual(checks, []);
  page.visibilityState = "visible";
  listeners.visibilitychange?.();
  assert.deepEqual(checks, ["check"]);
});
