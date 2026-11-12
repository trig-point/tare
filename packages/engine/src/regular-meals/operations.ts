import { fromStoredNutrition, toStoredNutrition } from "@tare/nutrition";
import { z as zod } from "zod";
import { writeTransaction } from "../db.ts";
import { insertIntake } from "../logging/intake.ts";
import {
  intakeRow,
  numbersFrom,
  nutrientFields,
  validateNumbers,
} from "../logging/schemas.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { archiveRegularMeal } from "../queries/archive-regular-meal.ts";
import { insertFood } from "../queries/insert-food.ts";
import { insertRegularMeal } from "../queries/insert-regular-meal.ts";
import { selectRegularMeal } from "../queries/select-regular-meal.ts";
import { updateRegularMeal } from "../queries/update-regular-meal.ts";
import { updateRegularMealFood } from "../queries/update-regular-meal-food.ts";

const text = zod.string().trim().min(1);
const identifier = zod.number().int().positive();
const baseline = zod.enum(["menu", "label", "estimate"]);
const saveInput = zod
  .strictObject({
    action: zod
      .enum(["create", "update", "delete"])
      .describe(
        "Update replaces the whole meal; omitted optional fields are cleared.",
      ),
    id: identifier.optional(),
    name: text.optional(),
    restaurant: text.nullable().optional(),
    ...zod.object(nutrientFields).partial().shape,
    kcal: zod.number().nonnegative().optional(),
    protein_g: zod.number().nonnegative().optional(),
    baseline: baseline.optional(),
    source: text.optional(),
  })
  .superRefine((input, context) => {
    if (
      (input.action === "create"
        ? input.id !== undefined
        : input.id === undefined) ||
      (input.action !== "delete" &&
        (input.name === undefined ||
          input.kcal === undefined ||
          input.protein_g === undefined ||
          input.baseline === undefined ||
          (input.baseline !== "estimate" && input.source === undefined)))
    )
      context.addIssue({ code: "custom", message: "Incomplete meal" });
  });
const mealRow = zod.strictObject({
  id: identifier,
  user_id: identifier,
  name: zod.string(),
  serving_size: zod.number().nullable(),
  serving_unit: zod.string().nullable(),
  ...nutrientFields,
  provenance: zod.enum(["label", "estimated"]),
  source: zod.string().nullable(),
  source_food_id: zod.number().nullable(),
  restaurant: zod.string().nullable(),
  baseline,
  created_at: zod.string(),
});
const shared = {
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser_and_agent",
  admin: false,
  method: "POST",
  bodyLimit: 8192,
} as const;

const saveRegularMeal = defineOperation({
  ...shared,
  name: "save_regular_meal",
  path: "/api/regular-meals",
  input: saveInput,
  output: zod
    .strictObject({
      meal: mealRow.optional(),
      deleted: zod.literal(true).optional(),
    })
    .refine(
      (result) =>
        (result.meal === undefined) !== (result.deleted === undefined),
    ),
  handler(input, context) {
    const body = writeTransaction(context.database, () => {
      const user_id = operationPerson(context).id;
      const owner = { user_id, id: input.id as number };
      if (
        input.action !== "create" &&
        !selectRegularMeal(context.database, owner)
      )
        throw new OperationError(404, "not_found");
      if (input.action === "delete") {
        const archived = archiveRegularMeal(
          context.database,
          {
            archived_at: context.clock.now().toISOString(),
          },
          owner,
        );
        if (!archived[0]) throw new Error("Meal archive returned no row");
        return { deleted: true };
      }
      const numbers = numbersFrom(input);
      validateNumbers(numbers);
      const provenance = input.baseline === "estimate" ? "estimated" : "label";
      const nutrition = toStoredNutrition(
        {
          source: "own",
          ...fromStoredNutrition({
            ...numbers,
            serving_size: 1,
            serving_unit: "meal",
            provenance,
          }),
        },
        "food",
      );
      if (!nutrition.ok) throw new OperationError(400, "invalid_request");
      const values = {
        ...numbers,
        ...nutrition.row,
        user_id,
        name: input.name as string,
        source: input.source ?? null,
      };
      const metadata = {
        restaurant: input.restaurant ?? null,
        baseline: input.baseline as zod.infer<typeof baseline>,
      };
      let id = owner.id;
      if (input.action === "create") {
        const food = insertFood(context.database, {
          ...values,
          source_food_id: null,
        });
        if (!food) throw new Error("Meal food insert returned no row");
        id = food.id;
        const inserted = insertRegularMeal(context.database, {
          ...metadata,
          user_id,
          food_id: id,
          created_at: context.clock.now().toISOString(),
        });
        if (!inserted) throw new Error("Meal insert returned no row");
      } else {
        if (!updateRegularMealFood(context.database, values, owner)[0])
          throw new Error("Meal food update returned no row");
        if (!updateRegularMeal(context.database, metadata, owner)[0])
          throw new Error("Meal update returned no row");
      }
      const meal = selectRegularMeal(context.database, { user_id, id });
      if (!meal) throw new Error("Saved meal not found");
      return { meal };
    });
    return { status: input.action === "create" ? 201 : 200, body };
  },
});

const logRegularMeal = defineOperation({
  ...shared,
  name: "log_regular_meal",
  path: "/api/regular-meals/log",
  input: zod.strictObject({
    id: identifier,
    client_id: text,
    eaten_at: zod.string(),
  }),
  output: zod.strictObject({ entry: intakeRow, created: zod.boolean() }),
  handler(input, context) {
    const person = operationPerson(context);
    const body = writeTransaction(context.database, (scope) => {
      // Replays must still reject meals this person cannot log.
      if (
        !selectRegularMeal(context.database, {
          user_id: person.id,
          id: input.id,
        })
      )
        throw new OperationError(404, "not_found");
      return insertIntake(
        scope,
        person,
        {
          client_id: input.client_id,
          eaten_at: input.eaten_at,
          reference: { kind: "food", id: input.id },
          servings: 1,
          claim: {},
        },
        context.clock,
        "suppress",
      );
    });
    return { status: body.created ? 201 : 200, body };
  },
});

export const regularMealOperations = [saveRegularMeal, logRegularMeal];
