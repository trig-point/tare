import { z as zod } from "zod";
import type { Config } from "../config.ts";
import { scopeDatabase } from "../db.ts";
import { mealNutritionKinds } from "../meal-nutrition/index.ts";
import { OperationError } from "../operations/registry.ts";
import { selectPerson } from "../queries/select-person.ts";
import { selectReconcileEmail } from "../queries/select-reconcile-email.ts";
import { updateEmailReconciliation } from "../queries/update-email-reconciliation.ts";
import type { QuestionKind } from "../questions/kinds.ts";
import { reconcileEmail } from "./reconcile.ts";
import {
  type corrections,
  dateAnswer,
  foldAnswer,
  lateAnswer,
  readOrderDraft,
  reviewAnswer,
} from "./reconcile-input.ts";

export const heldEmailKind: QuestionKind = {
  name: "held_order_email",
  answer: zod.strictObject({ release: zod.boolean() }),
  apply() {
    throw new OperationError(409, "held_email_answer_unavailable");
  },
};

const metadata = zod.object({
  mode: zod.enum(["blocking", "advisory"]).optional(),
  fields: zod.array(zod.string()).optional(),
  target: zod
    .discriminatedUnion("type", [
      zod.strictObject({
        type: zod.literal("existing"),
        id: zod.number().int(),
      }),
      zod.strictObject({
        type: zod.literal("new"),
        service: zod.string(),
        delivery_date: zod.iso.date(),
      }),
    ])
    .optional(),
});

export function createOrderQuestionKinds({
  clock,
  services = {},
}: {
  clock: { now(): Date };
  services?: Config["orderEmailServices"];
}): ReadonlyMap<string, QuestionKind> {
  const kinds = [
    ["order_review", reviewAnswer],
    ["order_delivery_date", dateAnswer],
    ["order_late_list", lateAnswer],
  ] as const;
  return new Map([
    ...mealNutritionKinds,
    [heldEmailKind.name, heldEmailKind],
    ...kinds.map(([name, answer]): [string, QuestionKind] => [
      name,
      {
        name,
        answer,
        apply(scope, question, value, questionKinds) {
          const database = scopeDatabase(scope);
          const person =
            question.user_id === null
              ? null
              : selectPerson(database, { id: question.user_id });
          const email = person
            ? selectReconcileEmail(database, {
                user_id: person.id,
                id: zod.coerce
                  .number()
                  .int()
                  .positive()
                  .parse(question.subject_ref),
              })
            : null;
          if (!person || !email) throw new OperationError(404, "not_found");
          const details = metadata.parse(JSON.parse(question.answer_schema));
          const now = clock.now().toISOString();
          const save = (
            manual: string | null,
            disposition = email.disposition,
          ) => {
            const updated = updateEmailReconciliation(
              database,
              {
                disposition,
                now,
                manual_result: manual,
                applied_order_id: email.applied_order_id,
              },
              email,
            );
            if (updated.changes !== 1) throw new Error("Email update failed");
          };
          if (name === "order_late_list") {
            const answer = lateAnswer.parse(value);
            if (!details.target) throw new Error("Late question has no target");
            if (answer.action === "ignore") {
              save(email.manual_result, "reconciled");
              return { status: "applied" };
            }
            if (details.target.type !== "new")
              throw new OperationError(400, "invalid_answer");
            const draft = readOrderDraft(email);
            if (
              draft.service !== details.target.service ||
              draft.delivery_date !== details.target.delivery_date
            )
              throw new OperationError(409, "order_superseded");
            return reconcileEmail(
              scope,
              email,
              person,
              now,
              {
                questionKinds,
                services,
                answer: { id: question.id, acceptNew: true },
              },
              "fromAnswer",
            );
          }
          let fixes: zod.infer<typeof corrections>;
          const advisory =
            name === "order_review" && details.mode === "advisory";
          if (name === "order_delivery_date") fixes = dateAnswer.parse(value);
          else {
            if (!details.mode || !details.fields)
              throw new Error("Review question has no mode or fields");
            const answer = reviewAnswer.parse(value);
            if (advisory) {
              if ("confirm" in answer) return { status: "applied" };
              if (!("corrections" in answer))
                throw new OperationError(400, "invalid_answer");
              fixes = answer.corrections;
              if (
                fixes.service !== undefined ||
                fixes.kind !== undefined ||
                fixes.delivery_date !== undefined
              )
                throw new OperationError(400, "invalid_answer");
            } else {
              if ("confirm" in answer || "corrections" in answer)
                throw new OperationError(400, "invalid_answer");
              fixes = answer;
              const supplied = new Set(Object.keys(fixes));
              const fullMeals = fixes.meals?.every(
                (meal) => !("source_index" in meal),
              );
              for (const meal of fixes.meals ?? []) {
                if (!("source_index" in meal)) continue;
                for (const field of Object.keys(meal))
                  supplied.add(
                    `meals[${meal.source_index}]${field === "name" ? "" : `.${field}`}`,
                  );
              }
              if (
                !details.fields.every(
                  (field) =>
                    supplied.has(field) ||
                    (fullMeals && field.startsWith("meals")),
                )
              )
                throw new OperationError(400, "invalid_answer");
            }
          }
          const partial = foldAnswer(email, fixes);
          save(JSON.stringify({ partial }));
          return reconcileEmail(
            scope,
            email,
            person,
            now,
            { questionKinds, services, answer: { id: question.id, advisory } },
            "fromAnswer",
          );
        },
      },
    ]),
  ]);
}
