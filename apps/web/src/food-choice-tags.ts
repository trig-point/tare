import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { Choice } from "./eating-out-fields.ts";

type Reference = { kind?: "food" | "source_food" | "meal"; id?: number };
type ChoiceRow = Choice & { reference: Reference };
type Batch = { foods: ChoiceRow[]; updatedAt: number };
type Tags = ReadonlyMap<string, Choice & { updatedAt: number }>;

function key(reference: Reference) {
  return `${reference.kind}:${reference.id}`;
}

export function mergeFoodChoiceTags(previous: Tags, batches: Batch[]): Tags {
  let next: Map<string, Choice & { updatedAt: number }> | undefined;
  for (const { foods, updatedAt } of batches) {
    for (const food of foods) {
      if (
        !food.reference.kind ||
        food.reference.id === undefined ||
        food.can_tag_eating_out === undefined
      )
        continue;
      const reference = key(food.reference);
      const existing = (next ?? previous).get(reference);
      if (
        existing &&
        (existing.updatedAt > updatedAt ||
          (existing.updatedAt === updatedAt &&
            (existing.can_tag_eating_out === false ||
              food.can_tag_eating_out === true)))
      )
        continue;
      next ??= new Map(previous);
      next.set(reference, {
        updatedAt,
        can_tag_eating_out: food.can_tag_eating_out,
        eating_out_default: food.eating_out_default,
      });
    }
  }
  return next ?? previous;
}

const empty: Tags = new Map();
const tagsKey = (person: number) => ["food-choice-tags", person] as const;

export function useFoodChoiceTags(person: number, batches: Batch[]) {
  const client = useQueryClient();
  const queryKey = tagsKey(person);
  const { data = empty } = useQuery<Tags>({
    queryKey,
    enabled: false,
    gcTime: Infinity,
  });
  useEffect(() => {
    if (batches.length)
      client.setQueryData<Tags>(tagsKey(person), (cached) =>
        mergeFoodChoiceTags(cached ?? empty, batches),
      );
  }, [client, person, batches]);
  const latest = mergeFoodChoiceTags(data, batches);
  return <Food extends ChoiceRow>(food: Food): Food => {
    const tags = latest.get(key(food.reference));
    return tags
      ? {
          ...food,
          eating_out_default: tags.eating_out_default,
          can_tag_eating_out: tags.can_tag_eating_out,
        }
      : food;
  };
}
