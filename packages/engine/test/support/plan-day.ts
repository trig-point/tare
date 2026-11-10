import type { Database } from "better-sqlite3";
import { profile } from "./adaptive-seed.ts";
import type { twoUsers } from "./two-users.ts";

type Person = Awaited<ReturnType<typeof twoUsers>>["admin"];
const breakfastAndDinner = [
  { name: "Breakfast", start_minute: 0, end_minute: 600, share: 72 },
  { name: "Dinner", start_minute: 600, end_minute: 1440, share: 28 },
];

/** Gives the person these slots every day and a 2000 kcal target; returns a 100 kcal food id. */
export async function planDay(
  database: Database,
  person: Person,
  timezone: string,
  slots = breakfastAndDinner,
) {
  const post = async (path: string, body: unknown) =>
    (
      await person.request(path, { method: "POST", body: JSON.stringify(body) })
    ).json();
  database
    .prepare("UPDATE users SET timezone = ?, day_start_hour = 0 WHERE id = ?")
    .run(timezone, person.user.id);
  const body = { action: "create", name: "Example day", slots };
  const { template } = await post("/api/plan/templates", body);
  const { day_type } = await post("/api/plan/day-types", {
    action: "create",
    name: "Example type",
    template_id: template.id,
  });
  await post("/api/plan/default-day-type", { day_type_id: day_type.id });
  await post("/api/profile", profile);
  await post("/api/weights", { client_id: "w", weight_kg: 80 });
  database
    .prepare(
      "INSERT INTO target_results (user_id, computed_at, trigger, kcal, protein_g, basis) VALUES (?, '2026-01-01T00:00:00.000Z', 'weekly', 2000, 120, 'formula')",
    )
    .run(person.user.id);
  const soup = database
    .prepare(
      "INSERT INTO foods (user_id, name, kcal, provenance) VALUES (?, 'Example soup', 100, 'estimated')",
    )
    .run(person.user.id);
  return Number(soup.lastInsertRowid);
}
