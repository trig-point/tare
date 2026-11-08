import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "./api.ts";
import { planKey } from "./plan-api.ts";

export const questionSchema = z.object({
  id: z.number(),
  kind: z.string(),
  subject_ref: z.string(),
  prompt: z.string(),
  answer_schema: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});
export type Question = z.infer<typeof questionSchema>;
export type LabelValues = {
  kcal: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
  fiber_g: string;
  source: string;
};
export const blankLabel: LabelValues = {
  kcal: "",
  protein_g: "",
  carbs_g: "",
  fat_g: "",
  fiber_g: "",
  source: "",
};

export const questionsKey = (person: number) => ["questions", person] as const;

export async function readQuestions(signal: AbortSignal) {
  return z
    .object({ questions: z.array(questionSchema) })
    .parse(await api("/api/questions", { signal })).questions;
}

export async function answerQuestion(id: number, answer: unknown) {
  return z.object({ id: z.number(), status: z.literal("answered") }).parse(
    await api("/api/questions/answer", {
      method: "POST",
      body: JSON.stringify({ id, answer }),
    }),
  );
}

export function labelAnswer(values: LabelValues) {
  const number = (value: string) => Number(value.trim());
  return {
    kcal: number(values.kcal),
    protein_g: number(values.protein_g),
    carbs_g: number(values.carbs_g),
    fat_g: number(values.fat_g),
    ...(values.fiber_g.trim() === ""
      ? {}
      : { fiber_g: number(values.fiber_g) }),
    source: values.source.trim(),
  };
}

// An advisory review accepts a bare confirmation; a blocking one needs corrections.
export function advisory(question: Question) {
  return question.answer_schema.mode === "advisory";
}

const lateTarget = z.object({
  target: z.object({ type: z.enum(["new", "existing"]) }),
});

// The engine accepts a late list only into a new order; an existing one can only be ignored.
export function lateTargetIsNew(question: Question) {
  const parsed = lateTarget.safeParse(question.answer_schema);
  return parsed.success && parsed.data.target.type === "new";
}

export async function refreshAnswered(client: QueryClient, person: number) {
  await Promise.all([
    client.invalidateQueries({ queryKey: questionsKey(person) }),
    client.invalidateQueries({ queryKey: ["find_food", person] }),
    client.invalidateQueries({ queryKey: planKey(person) }),
  ]);
}
