import type { Database } from "better-sqlite3";
import { writeTransaction } from "../../src/db.ts";
import { mealNutritionKinds } from "../../src/meal-nutrition/index.ts";
import { createOrder } from "../../src/orders/index.ts";
import type { twoUsers } from "./two-users.ts";

type Person = Awaited<ReturnType<typeof twoUsers>>["admin"];
const label = { kcal: 600, protein_g: 35, carbs_g: 60, fat_g: 20 };

/** Orders one meal for the person and answers its nutrition question. */
export async function orderMeal(
  database: Database,
  person: Person,
  delivery_date: string,
  quantity: number,
  now: string,
) {
  const meals = [{ name: "Example bowl", chef: null, quantity }];
  const input = { service: "Example", delivery_date, meals };
  const order = writeTransaction(database, (scope) =>
    createOrder(
      scope,
      person.user,
      { ...input, status: "scheduled" },
      mealNutritionKinds,
      now,
    ),
  );
  const { questions } = await (await person.request("/api/questions")).json();
  for (const { id } of questions)
    await person.request("/api/questions/answer", {
      method: "POST",
      body: JSON.stringify({ id, answer: { ...label, source: "Label" } }),
    });
  return database
    .prepare("SELECT id FROM order_meals WHERE order_id = ?")
    .pluck()
    .get(order.id) as number;
}
