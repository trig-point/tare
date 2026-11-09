import type { Database } from "better-sqlite3";

const now = new Date("2026-01-01T00:00:00.000Z");

export function weigh(
  database: Database,
  userId: number,
  clientId: string,
  day: string,
  kg = 80,
) {
  database
    .prepare(
      "INSERT INTO weights(user_id,client_id,day,measured_at,weight_kg,created_at) VALUES (?,?,?,?,?,?)",
    )
    .run([
      userId,
      clientId,
      day,
      `${day}T12:00:00.000Z`,
      kg,
      now.toISOString(),
    ]);
}
/** Four weeks of signed days ending 2026-01-01 at 80 kg and 2675 kcal, enough for an adaptive estimate. */
export function seed(database: Database, userId: number) {
  for (let offset = 0; offset <= 28; offset++) {
    const day = new Date(Date.UTC(2025, 11, 3 + offset))
      .toISOString()
      .slice(0, 10);
    weigh(database, userId, `weight-${offset}`, day);
    if (!offset) continue;
    database
      .prepare(
        "INSERT INTO intake_entries(user_id,client_id,day,eaten_at,name,kcal,kcal_low,kcal_high,provenance,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        userId,
        `food-${offset}`,
        day,
        `${day}T12:00:00.000Z`,
        "Example meal",
        2675,
        2660,
        2705,
        "estimated",
        now.toISOString(),
        now.toISOString(),
      );
    database
      .prepare(
        "UPDATE days SET signed_off_at = ? WHERE user_id = ? AND day = ?",
      )
      .run(now.toISOString(), userId, day);
  }
}
