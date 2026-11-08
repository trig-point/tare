import { z as zod } from "zod";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { dismissTargetNotice } from "../queries/dismiss-target-notice.ts";

export const targetNoticeSchema = zod
  .strictObject({
    id: zod.number().int(),
    created_at: zod.string(),
    old_kcal: zod.number(),
    old_protein_g: zod.number(),
    new_kcal: zod.number(),
    new_protein_g: zod.number(),
  })
  .nullable();

export const targetNoticeOperations = [
  defineOperation({
    modes: ["access", "fallback"],
    callerClass: "browser",
    admin: false,
    name: "dismiss_target_notice",
    method: "POST",
    path: "/api/target-notice/dismiss",
    bodyLimit: 1024,
    input: zod.strictObject({ id: zod.number().int().positive() }),
    output: zod.strictObject({ id: zod.number().int() }),
    handler(input, context) {
      const dismissed = dismissTargetNotice(
        context.database,
        { dismissed_at: context.clock.now().toISOString() },
        { id: input.id, user_id: operationPerson(context).id },
      );
      if (!dismissed) throw new OperationError(404, "not_found");
      return { status: 200, body: dismissed };
    },
  }),
];
