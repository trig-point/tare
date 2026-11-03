import { z as zod } from "zod";
import {
  defineOperation,
  type OperationContext,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { answerQuestion } from "../queries/answer-question.ts";
import { listOpenQuestions } from "../queries/list-open-questions.ts";
import { selectQuestion } from "../queries/select-question.ts";
import { selectUser } from "../queries/select-user.ts";

function visibility(context: OperationContext) {
  const actorId = operationPerson(context).id;
  const browser =
    context.credential === "session" || context.credential === "access";
  return {
    actor_id: actorId,
    actor_is_admin_browser: Number(
      browser &&
        Boolean(selectUser(context.database, { id: actorId })?.is_admin),
    ),
  };
}

const questionOutput = zod.strictObject({
  id: zod.number().int(),
  kind: zod.string(),
  subject_ref: zod.string(),
  prompt: zod.string(),
  answer_schema: zod.record(zod.string(), zod.unknown()),
  created_at: zod.string(),
});
const queueOperation = {
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser_and_agent" as const,
  admin: false,
};

export const questionOperations = [
  defineOperation({
    ...queueOperation,
    name: "list_questions",
    method: "GET",
    path: "/api/questions",
    input: zod.strictObject({}),
    output: zod.strictObject({ questions: zod.array(questionOutput) }),
    handler(_input, context) {
      const questions = listOpenQuestions(
        context.database,
        visibility(context),
      );
      return {
        status: 200,
        body: {
          questions: questions.map((question) => ({
            ...question,
            answer_schema: JSON.parse(question.answer_schema),
          })),
        },
      };
    },
  }),
  defineOperation({
    ...queueOperation,
    name: "answer_question",
    method: "POST",
    path: "/api/questions/answer",
    bodyLimit: 8192,
    input: zod.strictObject({
      id: zod.number().int().positive(),
      answer: zod.unknown(),
    }),
    output: zod.strictObject({
      id: zod.number().int(),
      status: zod.literal("answered"),
    }),
    handler(input, context) {
      const { database, clock } = context;
      return database
        .transaction(() => {
          const actor = visibility(context);
          const question = selectQuestion(database, { ...actor, id: input.id });
          if (!question) throw new OperationError(404, "not_found");
          if (question.status === "answered")
            throw new OperationError(409, "already_answered");
          const kind = context.questionKinds?.get(question.kind);
          if (!kind) throw new OperationError(409, "kind_not_supported");
          const answer = kind.answer.safeParse(input.answer);
          if (!answer.success) throw new OperationError(400, "invalid_answer");
          kind.apply(database, question, answer.data);
          const closed = answerQuestion(
            database,
            {
              answer: JSON.stringify(answer.data),
              answered_at: clock.now().toISOString(),
            },
            { ...actor, id: question.id },
          );
          if (closed.length !== 1) throw new Error("Could not close question");
          return {
            status: 200 as const,
            body: { id: question.id, status: "answered" },
          };
        })
        .immediate();
    },
  }),
];
