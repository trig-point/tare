import type { Person } from "../auth/middleware.ts";
import type { SelectLedgerEntriesResult } from "../queries/select-ledger-entries.ts";
import type { SelectTemplateSlotsResult } from "../queries/select-template-slots.ts";

type DayPerson = Pick<Person, "timezone" | "day_start_hour">;
type Slot = SelectTemplateSlotsResult;
type Entry = Pick<
  SelectLedgerEntriesResult,
  | "day"
  | "eaten_at"
  | "slot_template_id"
  | "slot_position"
  | "kcal"
  | "protein_g"
>;

export function minuteOfDay(instant: string, person: DayPerson) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: person.timezone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(instant));
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return (hour * 60 + minute - person.day_start_hour * 60 + 1440) % 1440;
}

export function assignSlot(slots: Slot[], minute: number): Slot | null {
  const ordered = slots.toSorted(
    (left, right) => left.start_minute - right.start_minute,
  );
  return (
    ordered.find(
      (slot) => slot.start_minute <= minute && minute < slot.end_minute,
    ) ??
    ordered.find((slot) => slot.start_minute > minute) ??
    ordered.at(-1) ??
    null
  );
}

export function slotBudgets(
  slots: Slot[],
  entries: Entry[],
  target: { kcal: number; protein_g: number },
  day: string,
  now: string,
  person: DayPerson,
) {
  const minute = minuteOfDay(now, person);
  const ordered = slots.toSorted(
    (left, right) => left.start_minute - right.start_minute,
  );
  const assigned = entries
    .filter((entry) => entry.day === day)
    .map((entry) => ({
      entry,
      slot:
        ordered.find(
          (slot) =>
            slot.template_id === entry.slot_template_id &&
            slot.position === entry.slot_position,
        ) ?? assignSlot(ordered, minuteOfDay(entry.eaten_at, person)),
    }));
  const rows = ordered.map((slot, index) => {
    const matches = assigned
      .filter((value) => value.slot === slot)
      .map((value) => value.entry);
    const total = (key: "kcal" | "protein_g") => {
      const complete = matches.every((entry) => entry[key] !== null);
      const known_subtotal = Math.round(
        matches.reduce((sum, entry) => sum + (entry[key] ?? 0), 0),
      );
      return {
        intake: complete ? known_subtotal : null,
        known_subtotal,
        complete,
        budget: null as number | null,
        remaining: null as number | null,
      };
    };
    return {
      template_id: slot.template_id,
      position: slot.position,
      name: slot.name,
      window_start: slot.start_minute,
      window_end: slot.end_minute,
      ended: index < ordered.length - 1 && minute >= slot.end_minute,
      kcal: total("kcal"),
      protein_g: total("protein_g"),
    };
  });
  const openShares = ordered.reduce(
    (sum, slot, index) => sum + (rows[index]?.ended ? 0 : slot.share_bp),
    0,
  );
  for (const key of ["kcal", "protein_g"] as const) {
    const ended = rows.filter((row) => row.ended);
    const available = ended.every((row) => row[key].complete)
      ? Math.max(
          0,
          target[key] -
            ended.reduce((sum, row) => sum + (row[key].intake as number), 0),
        )
      : null;
    let allocated = 0;
    for (const [index, row] of rows.entries()) {
      const value = row[key];
      const share = ordered[index] as Slot;
      value.budget = row.ended
        ? value.intake
        : available === null
          ? null
          : index === rows.length - 1
            ? available - allocated
            : Math.floor((available * share.share_bp) / openShares);
      if (!row.ended && value.budget !== null) allocated += value.budget;
      value.remaining =
        value.budget === null || value.intake === null
          ? null
          : value.budget - value.intake;
    }
  }
  return rows;
}
