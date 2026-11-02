import assert from "node:assert/strict";
import { test } from "node:test";
import { foldName, sameName } from "../src/index.ts";

test("full Unicode folding imports through the nutrition package", () => {
  assert.equal(foldName("WEIẞBIER"), "weissbier");
});

const goldenFolds = [
  ["WEIẞBIER", "weissbier"],
  ["Weißbier", "weissbier"],
  ["WEISSBIER", "weissbier"],
  ["ﬁsh", "fish"],
  ["ΟΔΟΣ", "οδοσ"],
  ["µ", "μ"],
  ["ſ", "s"],
  ["İ", "i\u0307"],
  ["ı", "ı"],
  ["Cafe\u0301", "café"],
  ["  Chicken Bowl\u00a0", "chicken bowl"],
  ["", ""],
  [" \u00a0", ""],
] as const;
for (const [sample, expected] of goldenFolds) {
  test(`literal fold ${JSON.stringify(sample)}`, () => {
    assert.equal(foldName(sample), expected);
  });
  test(`idempotent fold ${JSON.stringify(sample)}`, () => {
    assert.equal(foldName(foldName(sample)), foldName(sample));
  });
}

test("name equality folds case and NFC while preserving accents and spacing", () => {
  for (const [left, right] of [
    ["Chicken Bowl", "chicken bowl"],
    ["WEISSBIER", "Weißbier"],
    ["Weißbier", "WEIẞBIER"],
    ["WEIẞBIER", "WEISSBIER"],
    ["Cafe\u0301", "CAFÉ"],
    ["  Chicken Bowl\u00a0", "chicken bowl"],
    ["οδος", "οδοσ"],
  ] as const)
    assert.equal(sameName(left, right), true, `${left} / ${right}`);
  for (const [left, right] of [
    ["Café", "Cafe"],
    ["Chicken  Bowl", "chicken bowl"],
    ["ıce", "ICE"],
    ["İstanbul", "istanbul"],
    ["Greek yogurt", "Greek yogurt, plain"],
    ["Bowl!", "Bowl"],
  ] as const)
    assert.equal(sameName(left, right), false, `${left} / ${right}`);
});
