export const activityCategories = [
  "strength",
  "cardio",
  "sauna",
  "cold_plunge",
  "other",
] as const;
export type ActivityCategory = (typeof activityCategories)[number];

const kindTable: Record<
  Exclude<ActivityCategory, "other"> | "known_other",
  string[]
> = {
  strength: [
    "strength",
    "strengthtraining",
    "weighttraining",
    "weightlifting",
    "weights",
    "lifting",
  ],
  cardio: [
    "walk",
    "walking",
    "run",
    "running",
    "jogging",
    "cycling",
    "biking",
    "hiking",
    "swimming",
    "elliptical",
    "rowing",
    "stairs",
    "hiit",
    "crosstraining",
    "dance",
    "tennis",
    "soccer",
    "basketball",
    "boxing",
    "crosscountryskiing",
    "golf",
  ],
  sauna: ["sauna"],
  cold_plunge: ["coldplunge", "icebath"],
  known_other: [
    "other",
    "yoga",
    "pilates",
    "stretching",
    "housework",
    "yardwork",
    "surfing",
  ],
};
// Oura and people spell names differently ("strengthTraining", "strength_training"), so keys drop case and punctuation.
const normalize = (kind: string) =>
  kind.toLowerCase().replace(/[^a-z0-9]/g, "");
const lookup = new Map(
  Object.entries(kindTable).flatMap(([category, names]) =>
    names.map((name) => [
      name,
      (category === "known_other" ? "other" : category) as ActivityCategory,
    ]),
  ),
);

export function activityCategory(kind: string) {
  const category = lookup.get(normalize(kind));
  return { category: category ?? "other", known: category !== undefined };
}

// Name never logged: a hand-typed kind can hold anything.
export function countUnknownKinds(kinds: string[], source: string) {
  const unknown = kinds.filter((kind) => !activityCategory(kind).known).length;
  if (unknown > 0) console.info("activity_kind_unknown", source, unknown);
}
