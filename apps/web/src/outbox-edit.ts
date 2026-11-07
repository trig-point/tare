import type { OutboxReplay } from "./outbox-replay.ts";
import type {
  EntryBody,
  EntryKind,
  JsonValue,
  QueueEntry,
} from "./outbox-store.ts";

export type EditorValues = Record<string, string | null | undefined>;
const textFields = new Set([
  "name",
  "source",
  "provenance",
  "portion_note",
  "eaten_at",
  "measured_at",
]);
// Untouched nulls must stay distinct from typed text.
export const inputValue = (value: JsonValue) =>
  value === null
    ? null
    : typeof value === "string"
      ? value
      : JSON.stringify(value);

export function editorPatch(body: EntryBody, values: EditorValues) {
  const patch: Record<string, JsonValue | undefined> = {};
  for (const [name, original] of Object.entries(body)) {
    if (name === "client_id") continue;
    const value = values[name];
    if (value == null) patch[name] = value;
    else if (typeof original === "string" || textFields.has(name))
      patch[name] = value;
    else patch[name] = JSON.parse(value);
  }
  return patch;
}

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
  const hasNumber = (field: string) =>
    body[field] != null && body[field] !== "null";
  return new Set(
    fields.filter((field) => {
      if (kind === "weight" || referenced) return true;
      // Manual intake needs a nutrient and keeps both ends of an energy range.
      if (nutrients.includes(field))
        return nutrients.some((other) => other !== field && hasNumber(other));
      if (field === "kcal_low") return !hasNumber("kcal_high");
      if (field === "kcal_high") return !hasNumber("kcal_low");
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
