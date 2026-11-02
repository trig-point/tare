import assert from "node:assert/strict";
import { test } from "node:test";
import { foldName } from "../src/index.ts";

test("full Unicode folding imports through the nutrition package", () => {
  assert.equal(foldName("WEIẞBIER"), "weissbier");
});
