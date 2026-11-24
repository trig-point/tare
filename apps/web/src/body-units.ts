export type BodyUnits = "metric" | "imperial";

const kilogramsPerPound = 0.45359237;
const centimetersPerInch = 2.54;

export const weightUnit = (units: BodyUnits) =>
  units === "imperial" ? "lb" : "kg";

export const weightFromKg = (kg: number, units: BodyUnits) =>
  units === "imperial" ? kg / kilogramsPerPound : kg;

export const weightToKg = (weight: number, units: BodyUnits) =>
  units === "imperial" ? weight * kilogramsPerPound : weight;

const imperialWeightFormat = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  maximumFractionDigits: 1,
});
const metricWeightFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});

export const formatBodyWeight = (kg: number, units: BodyUnits) =>
  units === "imperial" ? weightInput(kg, units) : metricWeightFormat.format(kg);

export function heightFromCm(cm: number) {
  const totalInches = Math.round(cm / centimetersPerInch);
  return { feet: Math.floor(totalInches / 12), inches: totalInches % 12 };
}

export const heightToCm = (feet: number, inches: number) =>
  Math.round((feet * 12 + inches) * centimetersPerInch * 10) / 10;

export const weightInput = (kg: number, units: BodyUnits) =>
  units === "imperial"
    ? imperialWeightFormat.format(weightFromKg(kg, units))
    : String(kg);

export function editedWeightKg(
  value: string,
  originalKg: number,
  units: BodyUnits,
) {
  return value.trim() &&
    Number(value) === Number(weightInput(originalKg, units))
    ? originalKg
    : weightToKg(Number(value), units);
}

export type MeasurementDraft = { text: string; units: BodyUnits };

export function weightDraftKg(draft: MeasurementDraft, originalKg?: number) {
  return originalKg === undefined
    ? weightToKg(Number(draft.text), draft.units)
    : editedWeightKg(draft.text, originalKg, draft.units);
}
