import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "./support.mts";
import "./tsx.mts";

let waiting = false;
let reloads = 0;
Object.assign(globalThis, {
  registerStub: () => ({
    needRefresh: [waiting],
    updateServiceWorker: async () => {
      reloads += 1;
    },
  }),
});
const { UpdateNotice } = await import("../src/update-notice.tsx");

test("a waiting version shows Update ready, and Reload activates it", () => {
  assert.equal(UpdateNotice(), null);
  waiting = true;
  const notice = UpdateNotice();
  assert.equal(
    renderToStaticMarkup(notice),
    '<output class="update-notice">Update ready<button type="button">Reload</button></output>',
  );
  notice?.props.children[1].props.onClick();
  assert.equal(reloads, 1);
});
