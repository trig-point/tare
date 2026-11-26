import { type QueryClient, skipToken, useQuery } from "@tanstack/react-query";
import type { Choice } from "./eating-out-fields.ts";

type Reference = { kind?: "food" | "source_food" | "meal"; id?: number };
type ChoiceRow = Choice & { reference: Reference };
type Tags = ReadonlyMap<string, Choice>;

function key(reference: Reference) {
  return `${reference.kind}:${reference.id}`;
}

const tagsKey = (person: number) => ["food-choice-tags", person] as const;

export function rememberFoodChoiceTags(
  client: QueryClient,
  person: number,
  foods: ChoiceRow[],
) {
  const queryKey = tagsKey(person);
  const previous = client.getQueryData<Tags>(queryKey);
  let next: Map<string, Choice> | undefined;
  for (const food of foods) {
    const { reference, can_tag_eating_out, eating_out_default } = food;
    if (
      !reference.kind ||
      reference.id === undefined ||
      can_tag_eating_out === undefined
    )
      continue;
    const referenceKey = key(reference);
    const existing = (next ?? previous)?.get(referenceKey);
    if (
      existing?.can_tag_eating_out === can_tag_eating_out &&
      existing.eating_out_default === eating_out_default
    )
      continue;
    next ??= new Map(previous);
    next.set(referenceKey, { can_tag_eating_out, eating_out_default });
  }
  if (next) {
    if (!previous) client.setQueryDefaults(queryKey, { gcTime: Infinity });
    client.setQueryData<Tags>(queryKey, next);
  }
}

export function useFoodChoiceTags(person: number) {
  const { data } = useQuery<Tags>({
    queryKey: tagsKey(person),
    queryFn: skipToken,
    gcTime: Infinity,
  });
  return <Food extends ChoiceRow>(food: Food): Food => {
    const tags = data?.get(key(food.reference));
    return tags ? { ...food, ...tags } : food;
  };
}
