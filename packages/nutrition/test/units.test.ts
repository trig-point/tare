import assert from "node:assert/strict";
import { test } from "node:test";
import {
  amountFor,
  type ConversionResult,
  type ServingBasis,
  servingsFor,
} from "../src/index.ts";

function value(result: ConversionResult): number {
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.ok(Number.isFinite(result.value) && result.value > 0);
  return result.value;
}
function close(actual: number, expected: number) {
  assert.ok(
    Math.abs(actual - expected) / Math.abs(expected) <= 1e-12,
    `${actual} != ${expected}`,
  );
}
const mass = (
  amount: number,
  unit: "g" | "kg" | "oz" | "lb" = "g",
): ServingBasis => ({ dimension: "mass", amount, unit });
const volume = (
  amount: number,
  unit: "ml" | "l" | "fl_oz" = "ml",
): ServingBasis => ({ dimension: "volume", amount, unit });

test("literal expected values pin every unit factor", () => {
  const rows: [number, string, ServingBasis, number][] = [
    [1, "kg", mass(1000), 1],
    [1, "lb", mass(453.59237), 1],
    [2, "oz", mass(28.349523125), 2],
    [1, "l", volume(250), 4],
    [1, "fl_oz", volume(1), 29.5735295625],
    [500, "g", mass(100), 5],
  ];
  for (const [amount, unit, basis, expected] of rows)
    close(value(servingsFor(amount, unit, basis)), expected);
  close(value(amountFor(3, "ml", volume(12, "fl_oz"))), 1064.64706425);
});

test("unit round trips in both directions within relative 1e-12", () => {
  const rows: [number, string, ServingBasis][] = [
    [150, "g", mass(40)],
    [1, "oz", mass(28)],
    [3, "lb", mass(100)],
    [355, "ml", volume(12, "fl_oz")],
    [0.1, "kg", mass(30)],
    [1e-6, "g", mass(100)],
    [1234.5678, "g", mass(7, "oz")],
    [1e9, "l", volume(0.5, "l")],
  ];
  for (const [input, unit, basis] of rows) {
    close(
      value(amountFor(value(servingsFor(input, unit, basis)), unit, basis)),
      input,
    );
    close(
      value(servingsFor(value(amountFor(input, unit, basis)), unit, basis)),
      input,
    );
  }
});

test("both functions reject nonpositive and nonfinite inputs and basis amounts", () => {
  for (const convert of [servingsFor, amountFor]) {
    for (const input of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0,
      -1,
    ]) {
      assert.deepEqual(convert(input, "g", mass(1)), {
        ok: false,
        reason: "not_positive",
      });
      assert.deepEqual(convert(1, "g", mass(input)), {
        ok: false,
        reason: "not_positive",
      });
    }
  }
});

test("overflow, underflow and nonfinite base scaling give out_of_range", () => {
  const cases: [typeof servingsFor, number, string, ServingBasis][] = [
    [servingsFor, 1, "g", mass(Number.MIN_VALUE)],
    [servingsFor, Number.MIN_VALUE, "g", mass(Number.MAX_VALUE)],
    [servingsFor, Number.MAX_VALUE, "kg", mass(1)],
    [servingsFor, 1, "g", mass(Number.MAX_VALUE, "lb")],
    [amountFor, Number.MAX_VALUE, "g", mass(2)],
    [amountFor, Number.MIN_VALUE, "g", mass(Number.MIN_VALUE)],
    [amountFor, 1, "g", mass(Number.MAX_VALUE, "kg")],
    [amountFor, Number.MIN_VALUE, "kg", mass(1)],
  ];
  for (const [convert, input, unit, basis] of cases)
    assert.deepEqual(convert(input, unit, basis), {
      ok: false,
      reason: "out_of_range",
    });
});

test("count units use exact text and dimensions never cross", () => {
  const basis: ServingBasis = { dimension: "count", amount: 2, unit: "bar" };
  assert.equal(value(servingsFor(6, "bar", basis)), 3);
  assert.equal(value(amountFor(3, "bar", basis)), 6);
  for (const convert of [servingsFor, amountFor]) {
    for (const unit of ["bars", "Bar", "meal"])
      assert.deepEqual(convert(2, unit, basis), {
        ok: false,
        reason: "count_unit_mismatch",
      });
    for (const [unit, other] of [
      ["g", volume(1)],
      ["ml", mass(1)],
      ["bar", mass(1)],
      ["g", basis],
    ] as const)
      assert.deepEqual(convert(1, unit, other), {
        ok: false,
        reason: "dimension_mismatch",
      });
  }
});
