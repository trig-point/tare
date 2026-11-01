import type { ServingBasis } from "./record.ts";

const FACTORS = {
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237,
  ml: 1,
  l: 1000,
  fl_oz: 29.5735295625,
} as const;

export type ConversionResult =
  | { readonly ok: true; readonly value: number }
  | {
      readonly ok: false;
      readonly reason:
        | "dimension_mismatch"
        | "count_unit_mismatch"
        | "not_positive"
        | "out_of_range";
    };

export function unitDimension(unit: string): ServingBasis["dimension"] {
  switch (unit) {
    case "g":
    case "kg":
    case "oz":
    case "lb":
      return "mass";
    case "ml":
    case "l":
    case "fl_oz":
      return "volume";
    default:
      return "count";
  }
}

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function convert(
  input: number,
  unit: string,
  basis: ServingBasis,
  reverse: boolean,
): ConversionResult {
  if (!positive(input) || !positive(basis.amount))
    return { ok: false, reason: "not_positive" };
  const dimension = unitDimension(unit);
  if (dimension !== basis.dimension)
    return { ok: false, reason: "dimension_mismatch" };
  if (dimension === "count" && unit !== basis.unit)
    return { ok: false, reason: "count_unit_mismatch" };
  const unitFactor =
    dimension === "count" ? 1 : FACTORS[unit as keyof typeof FACTORS];
  const basisFactor = basis.dimension === "count" ? 1 : FACTORS[basis.unit];
  const basisBase = basis.amount * basisFactor;
  const numerator = input * (reverse ? basisBase : unitFactor);
  const denominator = reverse ? unitFactor : basisBase;
  const value = numerator / denominator;
  if (![basisBase, numerator, denominator, value].every(positive))
    return { ok: false, reason: "out_of_range" };
  return { ok: true, value };
}

export function servingsFor(
  amount: number,
  unit: string,
  basis: ServingBasis,
): ConversionResult {
  return convert(amount, unit, basis, false);
}

export function amountFor(
  servings: number,
  unit: string,
  basis: ServingBasis,
): ConversionResult {
  return convert(servings, unit, basis, true);
}
