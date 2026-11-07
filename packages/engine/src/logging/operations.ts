import { z as zod } from "zod";
import { writeTransaction } from "../db.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { deleteIntake } from "../queries/delete-intake.ts";
import { deleteWeight } from "../queries/delete-weight.ts";
import { selectIntakeEntry } from "../queries/select-intake-entry.ts";
import { selectWeight } from "../queries/select-weight.ts";
import { updateIntake } from "../queries/update-intake.ts";
import { updateWeight } from "../queries/update-weight.ts";
import { canonicalInstant, localDay } from "./day.ts";
import { insertIntake, referenceSnapshot } from "./intake.ts";
import { resolveProvenance } from "./provenance.ts";
import {
  editIntakeInput,
  editWeightInput,
  idInput,
  intakeRow,
  logFoodInput,
  logWeightInput,
  numbersFrom,
  nutrientKeys,
  validateNumbers,
  weightRow,
} from "./schemas.ts";
import { insertWeight } from "./weight.ts";

const shared = {
  modes: ["access", "fallback"],
  callerClass: "browser_and_agent",
  admin: false,
} as const;
const base = { ...shared, modes: [...shared.modes], bodyLimit: 8192 };
const logFood = defineOperation({
  ...base,
  name: "log_food",
  description:
    "Use one food_id or source_food_id with servings and no name, source or nutrients. For ad hoc food, omit servings and provide a name and at least one of kcal, protein_g, carbs_g, fat_g or fiber_g.",
  method: "POST",
  path: "/api/intake",
  input: logFoodInput,
  inputIssues: true,
  output: zod.object({ entry: intakeRow, created: zod.boolean() }),
  handler(input, context) {
    const body = writeTransaction(context.database, (scope) =>
      insertIntake(
        scope,
        operationPerson(context),
        input.food_id !== undefined || input.source_food_id !== undefined
          ? {
              ...input,
              servings: input.servings as number,
              reference:
                input.food_id !== undefined
                  ? { kind: "food", id: input.food_id }
                  : { kind: "source_food", id: input.source_food_id as number },
              claim: { provenance: input.provenance },
            }
          : {
              ...input,
              name: input.name as string,
              numbers: numbersFrom(input),
              claim: { provenance: input.provenance, source: input.source },
            },
        context.clock,
      ),
    );
    return { status: body.created ? 201 : 200, body };
  },
});
const logWeight = defineOperation({
  ...base,
  name: "log_weight",
  method: "POST",
  path: "/api/weights",
  input: logWeightInput,
  output: zod.object({ entry: weightRow, created: zod.boolean() }),
  handler(input, context) {
    const body = writeTransaction(context.database, (scope) =>
      insertWeight(scope, operationPerson(context), input, context.clock),
    );
    return { status: body.created ? 201 : 200, body };
  },
});
const editIntake = defineOperation({
  ...base,
  name: "edit_intake",
  method: "PATCH",
  path: "/api/intake/:id",
  input: editIntakeInput,
  output: zod.object({ entry: intakeRow }),
  handler(input, context) {
    const person = operationPerson(context);
    const entry = writeTransaction(context.database, (scope) => {
      const owner = { user_id: person.id, id: input.id };
      const stored = selectIntakeEntry(context.database, owner);
      if (!stored) throw new OperationError(404, "not_found");
      const reference =
        stored.food_id !== null || stored.source_food_id !== null;
      const changesNumbers = nutrientKeys.some(
        (key) => input[key] !== undefined,
      );
      if (
        reference &&
        Object.keys(input).some(
          (key) =>
            !["id", "eaten_at", "servings", "portion_note"].includes(key),
        )
      )
        throw new OperationError(400, "invalid_request");
      if (!reference && input.servings !== undefined)
        throw new OperationError(400, "invalid_request");
      // A claim only applies to new numbers, so a claim-only patch would be a silent no-op.
      if (
        !changesNumbers &&
        (input.provenance !== undefined || input.source !== undefined)
      )
        throw new OperationError(400, "invalid_request");
      let merged = {
        ...stored,
        ...input,
        ...owner,
        provenance: stored.provenance,
        source: stored.source,
      };
      if (reference && input.servings !== undefined) {
        const ref =
          stored.food_id !== null
            ? { kind: "food" as const, id: stored.food_id }
            : {
                kind: "source_food" as const,
                id: stored.source_food_id as number,
              };
        merged = {
          ...merged,
          ...referenceSnapshot(scope, person, ref, input.servings),
        };
      } else if (changesNumbers) {
        merged.provenance = resolveProvenance(input, null);
        merged.source =
          input.source === undefined ? stored.source : input.source;
      }
      if (!reference) validateNumbers(numbersFrom(merged));
      merged.eaten_at =
        input.eaten_at === undefined
          ? stored.eaten_at
          : canonicalInstant(input.eaten_at);
      merged.day =
        input.eaten_at === undefined
          ? stored.day
          : localDay(merged.eaten_at, person.timezone, person.day_start_hour);
      merged.updated_at = context.clock.now().toISOString();
      if (merged.eaten_at !== stored.eaten_at) {
        merged.slot_template_id = null;
        merged.slot_position = null;
      }
      const updated = updateIntake(context.database, merged, owner)[0];
      if (!updated) throw new Error("Intake update returned no entry");
      return updated;
    });
    return { status: 200, body: { entry } };
  },
});
const editWeight = defineOperation({
  ...base,
  name: "edit_weight",
  method: "PATCH",
  path: "/api/weights/:id",
  input: editWeightInput,
  output: zod.object({ entry: weightRow }),
  handler(input, context) {
    const person = operationPerson(context);
    const entry = writeTransaction(context.database, () => {
      const owner = { user_id: person.id, id: input.id };
      const stored = selectWeight(context.database, owner);
      if (!stored) throw new OperationError(404, "not_found");
      const measured_at =
        input.measured_at === undefined
          ? stored.measured_at
          : canonicalInstant(input.measured_at);
      const updated = updateWeight(
        context.database,
        {
          ...stored,
          ...input,
          ...owner,
          measured_at,
          day:
            input.measured_at === undefined
              ? stored.day
              : localDay(measured_at, person.timezone, person.day_start_hour),
        },
        owner,
      )[0];
      if (!updated) throw new Error("Weight update returned no entry");
      return updated;
    });
    return { status: 200, body: { entry } };
  },
});
const deletes = (
  [
    ["delete_intake", "/api/intake/:id", deleteIntake],
    ["delete_weight", "/api/weights/:id", deleteWeight],
  ] as const
).map(([name, path, remove]) =>
  defineOperation({
    ...base,
    name,
    path,
    method: "DELETE",
    input: idInput,
    output: zod.object({ deleted: zod.literal(true), id: zod.number() }),
    handler(input, context) {
      const deleted = writeTransaction(context.database, () =>
        remove(context.database, {
          id: input.id,
          user_id: operationPerson(context).id,
        }),
      );
      if (!deleted[0]) throw new OperationError(404, "not_found");
      return { status: 200, body: { deleted: true, id: deleted[0].id } };
    },
  }),
);
export const loggingOperations = [
  logFood,
  editIntake,
  logWeight,
  editWeight,
  ...deletes,
];
