import type { OutboxReplay } from "./outbox-replay.ts";
import type { EntryKind, JsonValue, QueueEntry } from "./outbox-store.ts";

const nutrients = ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"];
export function removableFields(
  kind: EntryKind,
  body: Record<string, JsonValue | undefined>,
): ReadonlySet<string> {
  const fields =
    kind === "weight"
      ? ["body_fat_pct", "source"]
      : [
          "provenance",
          "source",
          "portion_note",
          ...nutrients,
          "kcal_low",
          "kcal_high",
        ];
  const referenced =
    body.food_id !== undefined || body.source_food_id !== undefined;
  return new Set(
    fields.filter((field) => {
      if (kind === "weight" || referenced) return true;
      // Manual intake needs a nutrient and keeps both ends of an energy range.
      if (nutrients.includes(field))
        return nutrients.some(
          (other) => other !== field && body[other] != null,
        );
      if (field === "kcal_low") return body.kcal_high == null;
      if (field === "kcal_high") return body.kcal_low == null;
      return true;
    }),
  );
}

export function editorAfterChange(editing: number | null, changed: number) {
  return editing === changed ? null : editing;
}

export function saveEntry(
  replay: Pick<OutboxReplay, "edit" | "resend">,
  entry: QueueEntry,
  patch: Record<string, JsonValue | undefined>,
) {
  const unchanged = Object.entries(patch).every(
    ([field, value]) =>
      JSON.stringify(value) === JSON.stringify(entry.body[field]),
  );
  return unchanged ? replay.resend(entry) : replay.edit(entry, patch);
}
