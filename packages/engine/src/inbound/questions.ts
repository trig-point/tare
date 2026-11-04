import { z as zod } from "zod";
import { scopeDatabase } from "../db.ts";
import { mealNutritionKinds } from "../meal-nutrition/index.ts";
import { OperationError } from "../operations/registry.ts";
import { selectPerson } from "../queries/select-person.ts";
import { selectReconcileEmail } from "../queries/select-reconcile-email.ts";
import type { QuestionKind } from "../questions/kinds.ts";
import {
  acceptLateList,
  finishEmail,
  lateAnswer,
  lateTarget,
} from "./reconcile.ts";
import { manualOrder } from "./reconcile-input.ts";

export const heldEmailKind: QuestionKind = {
  name: "held_order_email",
  answer: zod.strictObject({ release: zod.boolean() }),
  apply() {
    throw new OperationError(409, "held_email_answer_unavailable");
  },
};

export function createOrderQuestionKinds({
  clock,
}: {
  clock: { now(): Date };
}): ReadonlyMap<string, QuestionKind> {
  const late: QuestionKind = {
    name: "order_late_list",
    answer: lateAnswer,
    apply(scope, question, value, kinds) {
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
      const { target } = zod
        .object({ target: lateTarget })
        .parse(JSON.parse(question.answer_schema));
      const answer = lateAnswer.parse(value);
      const now = clock.now().toISOString();
      const input = manualOrder.parse(
        JSON.parse(email.manual_result ?? "null"),
      );
      if (answer.action === "ignore") {
        finishEmail(
          scope,
          email,
          now,
          "reconciled",
          email.applied_order_id,
          input,
        );
        return { status: "applied" };
      }
      if (target.type !== "new")
        throw new OperationError(400, "invalid_answer");
      if (
        input.service !== target.service ||
        input.delivery_date !== target.delivery_date
      )
        throw new Error("Late target changed");
      return acceptLateList(scope, email, person, now, kinds);
    },
  };
  return new Map([
    ...mealNutritionKinds,
    [heldEmailKind.name, heldEmailKind],
    [late.name, late],
  ]);
}
