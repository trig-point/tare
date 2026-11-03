import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import { OperationError } from "../operations/registry.ts";
import { insertQuestion } from "../queries/insert-question.ts";
import type { SelectQuestionResult } from "../queries/select-question.ts";

export interface QuestionKind {
  name: string;
  answer: zod.ZodType;
  apply(
    database: Database,
    question: SelectQuestionResult,
    answer: unknown,
  ): undefined;
}

export function createQuestion(
  database: Database,
  input: {
    userId: number | null;
    kind: string;
    subjectRef: string;
    prompt: string;
  },
  clock: { now(): Date },
  questionKinds: ReadonlyMap<string, QuestionKind>,
) {
  const kind = questionKinds.get(input.kind);
  if (!kind) throw new OperationError(409, "kind_not_supported");
  const question = insertQuestion(database, {
    user_id: input.userId,
    kind: input.kind,
    subject_ref: input.subjectRef,
    prompt: input.prompt,
    answer_schema: JSON.stringify(
      zod.toJSONSchema(kind.answer, { target: "draft-7", io: "input" }),
    ),
    created_at: clock.now().toISOString(),
  });
  if (!question) throw new Error("Could not create question");
  return question;
}
