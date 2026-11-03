import assert from "node:assert/strict";
import { slotBudgets } from "../src/plan/slots.ts";
import { test } from "./support/hang-ceiling.ts";

const day = "2026-01-01",
  person = { timezone: "UTC", day_start_hour: 0 };
const instant = (hour: number) =>
  `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const slots = [20, 30, 10, 40].map((share, position) => ({
  user_id: 1,
  template_id: 1,
  position,
  name: `Example ${position}`,
  start_minute: 420 + position * 240,
  end_minute: 540 + position * 240,
  share_bp: share * 100,
  fill_hint: null,
}));
const entry = (
  kcal: number | null,
  position: number,
  protein_g: number | null = kcal,
) => ({
  day,
  eaten_at: instant(8 + position * 4),
  kcal,
  protein_g,
  slot_template_id: 1,
  slot_position: position,
});
const target = { kcal: 2000, protein_g: 2000 };
const calculate = (entries: ReturnType<typeof entry>[], hour = 15) =>
  slotBudgets(slots, entries, target, day, instant(hour), person);
const nutrientKeys = ["kcal", "protein_g"] as const;

test("acceptance table, nutrient uncertainty and seeded budget laws", () => {
  for (const scenario of [
    ["heavy lunch", [400, 900], 15, 2000, [400, 900, 140, 560]],
    ["light lunch", [400, 300], 15, 2000, [400, 300, 260, 1040]],
    ["overspend", [400, 1700], 15, 2000, [400, 1700, 0, 0]],
    ["last open", [400, 600, 200, 600], 23, 2000, [400, 600, 200, 800]],
    ["late dinner", [400, 600, 200, 750], 23, 2000, [400, 600, 200, 800]],
    ["before target change", [400, 500], 15, 2000, [400, 500, 220, 880]],
    ["after target change", [400, 500], 15, 2200, [400, 500, 260, 1040]],
    ["remainder", [400, 599], 15, 2000, [400, 599, 200, 801]],
    ["fractional", [457.5], 10, 2000, [458, 578, 192, 772]],
    ["unknown ended", [null, 300], 15, 2000, [null, 300, null, null]],
    [
      "unknown protein",
      [400, 300],
      15,
      2000,
      [400, 300, 260, 1040],
      [null, 30],
      [null, 30, null, null],
    ],
    ["unknown open", [0, 0, null], 15, 2000, [0, 0, 400, 1600]],
  ] as const) {
    const [name, values, hour, kcal, expected, protein, expectedProtein] =
      scenario;
    const entries = values.map((value, position) =>
      entry(value, position, protein?.[position]),
    );
    const before = structuredClone(entries);
    target.kcal = target.protein_g = kcal;
    const rows = calculate(entries, hour);
    for (const key of nutrientKeys)
      assert.deepEqual(
        rows.map((row) => row[key].budget),
        key === "protein_g" ? (expectedProtein ?? expected) : expected,
        name,
      );
    if (name === "last open" || name === "late dinner")
      assert.equal(rows[3]?.kcal.remaining, name === "last open" ? 200 : 50);
    assert.deepEqual(entries, before);
  }
  let seed = 188;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed;
  };
  for (let sample = 0; sample < 40; sample++) {
    const entries = slots.map((slot) =>
      entry((next() % 20000) / 10, slot.position),
    );
    const before = structuredClone(entries);
    target.kcal = target.protein_g = next() % 4000;
    const rows = calculate(entries, sample % 24);
    target.kcal += 200;
    target.protein_g += 200;
    const changed = calculate(entries, sample % 24);
    for (const key of nutrientKeys) {
      const ended = rows.filter((row) => row.ended),
        open = rows.filter((row) => !row.ended);
      for (const row of ended)
        assert.deepEqual(
          [row[key].budget, changed[row.position]?.[key].budget],
          [Math.round(entries[row.position]?.[key] as number), row[key].intake],
        );
      assert.ok(
        open.every(
          (row) =>
            Number.isInteger(row[key].budget) &&
            (row[key].budget as number) >= 0,
        ),
      );
      assert.equal(
        open.reduce((sum, row) => sum + (row[key].budget as number), 0),
        Math.max(
          0,
          target[key] -
            200 -
            ended.reduce((sum, row) => sum + (row[key].intake as number), 0),
        ),
      );
    }
    assert.deepEqual(entries, before);
  }
});
