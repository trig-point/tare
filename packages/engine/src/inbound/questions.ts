import { z as zod } from "zod";
import { OperationError } from "../operations/registry.ts";
import type { QuestionKind } from "../questions/kinds.ts";

export const heldEmailKind: QuestionKind = {
  name: "held_order_email",
  answer: zod.strictObject({ release: zod.boolean() }),
  apply() {
    throw new OperationError(409, "held_email_answer_unavailable");
  },
};
