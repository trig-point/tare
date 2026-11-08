import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "./support.mts";
import "./tsx.mts";

const reloads: string[] = [];
const pwa = {
  needRefresh: [false],
  updateServiceWorker: async () => void reloads.push("reload"),
};
Object.assign(globalThis, { registerStub: () => pwa });
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
