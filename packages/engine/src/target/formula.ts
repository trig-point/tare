const activityFactors = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
} as const;

export interface FormulaInput {
  trendKg: number;
  heightCm: number;
  ageYears: number;
  sex: "male" | "female";
  activityLevel: keyof typeof activityFactors;
  goalRateKgWeek: number;
  proteinFactor: number;
}

export function ageYears(birthDate: string, today: string): number {
  return (
    Number(today.slice(0, 4)) -
    Number(birthDate.slice(0, 4)) -
    Number(today.slice(5) < birthDate.slice(5))
  );
}

export function formulaTarget(input: FormulaInput) {
  const resting_kcal =
    10 * input.trendKg +
    6.25 * input.heightCm -
    5 * input.ageYears +
    (input.sex === "male" ? 5 : -161);
  return {
    resting_kcal,
    kcal:
      Math.round(
        (resting_kcal * activityFactors[input.activityLevel] +
          (input.goalRateKgWeek * 7700) / 7) /
          10,
      ) * 10,
    protein_g: Math.round(input.proteinFactor * input.trendKg),
  };
}
