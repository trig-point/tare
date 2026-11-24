export type BodyUnits = "metric" | "imperial";

const kilogramsPerPound = 0.45359237;
const centimetersPerInch = 2.54;

export const weightUnit = (units: BodyUnits) =>
  units === "imperial" ? "lb" : "kg";

export const weightFromKg = (kg: number, units: BodyUnits) =>
  units === "imperial" ? kg / kilogramsPerPound : kg;

export const weightToKg = (weight: number, units: BodyUnits) =>
  units === "imperial" ? weight * kilogramsPerPound : weight;

const weightFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});

export const formatBodyWeight = (kg: number, units: BodyUnits) =>
  weightFormat.format(weightFromKg(kg, units));

export function heightFromCm(cm: number) {
  const totalInches = Math.round(cm / centimetersPerInch);
  return { feet: Math.floor(totalInches / 12), inches: totalInches % 12 };
}

export const heightToCm = (feet: number, inches: number) =>
  Math.round((feet * 12 + inches) * centimetersPerInch * 10) / 10;
