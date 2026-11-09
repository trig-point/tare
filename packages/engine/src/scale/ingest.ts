import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import type { Person } from "../auth/middleware.ts";
import type { ScaleConfig } from "../config.ts";
import { scopeDatabase, type WriteScope, writeTransaction } from "../db.ts";
import { canonicalInstant, localDay } from "../logging/day.ts";
import { insertWeight } from "../logging/weight.ts";
import { insertScaleReading } from "../queries/scale/insert-scale-reading.ts";
import { selectScaleReading } from "../queries/scale/select-scale-reading.ts";
import { selectScaleWindow } from "../queries/scale/select-scale-window.ts";
import { selectSubjectQuestion } from "../queries/scale/select-subject-question.ts";
import { selectWeightsBefore } from "../queries/scale/select-weights-before.ts";
import { selectPerson } from "../queries/select-person.ts";
import { selectUserByUsername } from "../queries/select-user-by-username.ts";
import { selectWeightByClient } from "../queries/select-weight-by-client.ts";
import { createQuestion, type QuestionKind } from "../questions/kinds.ts";
import { weightTrend } from "../trend/weight-trend.ts";

type Clock = { now(): Date };
export type ScaleReading = {
  clientId: string;
  measured_at: string;
  weight_kg: number;
  body_fat_pct: number | null;
};
type Stored =
  | "logged"
  | "duplicate"
  | "repeat"
  | "question_unmapped"
  | "question_implausible";
export type ScaleResult =
  | { status: Stored | "ignored" }
  | { status: "invalid_input" | "failed"; reason: string };

const WINDOW_MS = 10 * 60 * 1000;
const TREND_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_KG = 20;
const MAX_KG = 350;
const MAX_TREND_GAP_KG = 3;

const fields = {
  timestamp: zod.string().transform((value, context) => {
    try {
      return canonicalInstant(value);
    } catch {
      context.addIssue({ code: "custom", message: "invalid_time" });
      return zod.NEVER;
    }
  }),
  weight: zod.number().positive(),
  bodyFatPercent: zod.number().min(0).max(100).nullable().optional(),
};
const keepAnswer = zod.strictObject({ keep: zod.boolean() });
const acknowledgeAnswer = zod.strictObject({ acknowledged: zod.literal(true) });
const storedReading = zod.object({
  scale_reading: zod.strictObject({
    measured_at: fields.timestamp,
    weight_kg: fields.weight,
    body_fat_pct: zod.number().min(0).max(100).nullable(),
  }),
});

function parsePayload(payload: Buffer):
  | { reading: Omit<ScaleReading, "clientId"> }
  | {
      reason:
        | "not_json"
        | "not_object"
        | "bad_timestamp"
        | "bad_weight"
        | "bad_body_fat";
    } {
  let value: unknown;
  try {
    value = JSON.parse(payload.toString());
  } catch {
    return { reason: "not_json" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { reason: "not_object" };
  const record = value as Record<string, unknown>;
  const timestamp = fields.timestamp.safeParse(record.timestamp);
  if (!timestamp.success) return { reason: "bad_timestamp" };
  const weight = fields.weight.safeParse(record.weight);
  if (!weight.success) return { reason: "bad_weight" };
  const bodyFat = fields.bodyFatPercent.safeParse(record.bodyFatPercent);
  if (!bodyFat.success) return { reason: "bad_body_fat" };
  return {
    reading: {
      measured_at: timestamp.data,
      weight_kg: weight.data,
      body_fat_pct: bodyFat.data ?? null,
    },
  };
}

/** Runs inside the caller's transaction; used by the subscriber and by a kept question. */
export function acceptScaleReading(
  scope: WriteScope,
  person: Person,
  reading: ScaleReading,
  clock: Clock,
): "logged" | "duplicate" | "repeat" {
  const database = scopeDatabase(scope);
  // The ledger outlives the weight row, so a deleted or edited weight is not re-logged on replay.
  if (
    selectScaleReading(database, { client_id: reading.clientId }) ||
    selectWeightByClient(database, {
      user_id: person.id,
      client_id: reading.clientId,
    })
  )
    return "duplicate";
  const settle = <Status extends "logged" | "repeat">(status: Status) => {
    insertScaleReading(database, {
      client_id: reading.clientId,
      user_id: person.id,
      created_at: clock.now().toISOString(),
    });
    return status;
  };
  const instant = Date.parse(reading.measured_at);
  if (
    selectScaleWindow(database, {
      user_id: person.id,
      from: new Date(instant - WINDOW_MS).toISOString(),
      to: new Date(instant + WINDOW_MS).toISOString(),
    })
  )
    return settle("repeat");
  insertWeight(
    scope,
    person,
    {
      client_id: reading.clientId,
      measured_at: reading.measured_at,
      weight_kg: reading.weight_kg,
      body_fat_pct: reading.body_fat_pct,
      source: "scale",
    },
    clock,
  );
  return settle("logged");
}

function implausibility(
  database: Database,
  person: Person,
  reading: ScaleReading,
): string | null {
  const kg = (value: number) => `${Number(value.toFixed(1))} kg`;
  if (reading.weight_kg < MIN_KG || reading.weight_kg > MAX_KG)
    return `is outside ${MIN_KG} to ${MAX_KG} kg`;
  const history = selectWeightsBefore(database, {
    user_id: person.id,
    day: localDay(reading.measured_at, person.timezone, person.day_start_hour),
    measured_at: reading.measured_at,
  });
  const latest = history.at(-1);
  const trend = weightTrend(history).at(-1)?.trend_kg;
  if (
    trend === undefined ||
    !latest ||
    Date.parse(reading.measured_at) - Date.parse(latest.measured_at) >
      TREND_MAX_AGE_MS
  )
    return null;
  return Math.abs(reading.weight_kg - trend) > MAX_TREND_GAP_KG
    ? `is more than ${MAX_TREND_GAP_KG} kg from your trend of ${kg(trend)}`
    : null;
}

const localTime = (instant: string, timeZone: string) =>
  new Date(instant).toLocaleString("sv-SE", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  });

export function scaleQuestionKinds(clock: Clock): [string, QuestionKind][] {
  return [
    [
      "scale_unmapped",
      {
        name: "scale_unmapped",
        answer: acknowledgeAnswer,
        apply: () => ({ status: "applied" }),
      },
    ],
    [
      "scale_implausible",
      {
        name: "scale_implausible",
        answer: keepAnswer,
        apply(scope, question, value) {
          const database = scopeDatabase(scope);
          const person =
            question.user_id === null
              ? null
              : selectPerson(database, { id: question.user_id });
          if (!person) throw new Error("Scale question has no person");
          const { scale_reading } = storedReading.parse(
            JSON.parse(question.answer_schema),
          );
          if (keepAnswer.parse(value).keep)
            acceptScaleReading(
              scope,
              person,
              { ...scale_reading, clientId: question.subject_ref },
              clock,
            );
          return { status: "applied" };
        },
      },
    ],
  ];
}

export function resolveScaleUsers(database: Database, scale: ScaleConfig) {
  const users = new Map<string, number>();
  for (const [slug, username] of Object.entries(scale.users)) {
    const user = selectUserByUsername(database, { username });
    if (!user) throw new Error("TARE_SCALE_USERS names an unknown username");
    users.set(slug, user.id);
  }
  return users;
}

export function createScaleSubscriber({
  database,
  topic: baseTopic,
  users,
  questionKinds,
  clock,
  log = console.error,
  onLogged = () => {},
}: {
  database: Database;
  topic: string;
  users: ReadonlyMap<string, number>;
  questionKinds: ReadonlyMap<string, QuestionKind>;
  clock: Clock;
  log?: (code: string, detail?: string) => void;
  onLogged?: () => void;
}) {
  const counts = new Map<string, number>();
  const report = (
    status: "invalid_input" | "failed",
    reason: string,
  ): ScaleResult => {
    const count = (counts.get(`${status} ${reason}`) ?? 0) + 1;
    counts.set(`${status} ${reason}`, count);
    log(
      status === "failed" ? "scale_reading_failed" : "scale_reading_invalid",
      `${reason} ${count}`,
    );
    return { status, reason };
  };

  return (payload: Buffer, topic: string): ScaleResult => {
    if (topic === `${baseTopic}/status`) return { status: "ignored" };
    if (topic === baseTopic) return report("invalid_input", "missing_slug");
    const slug = topic.slice(baseTopic.length + 1);
    const parsed = parsePayload(payload);
    if ("reason" in parsed) return report("invalid_input", parsed.reason);
    const reading = {
      ...parsed.reading,
      clientId: `scale:${slug}:${parsed.reading.measured_at}`,
    };
    let status: Stored;
    try {
      status = writeTransaction(database, (scope): Stored => {
        const scoped = scopeDatabase(scope);
        if (selectSubjectQuestion(scoped, { subject_ref: reading.clientId }))
          return "duplicate";
        const userId = users.get(slug);
        if (userId === undefined) {
          createQuestion(
            scoped,
            {
              userId: null,
              kind: "scale_unmapped",
              subjectRef: reading.clientId,
              prompt: `Scale user "${slug}" has no person. Add it to TARE_SCALE_USERS to log later readings.`,
            },
            clock,
            questionKinds,
          );
          return "question_unmapped";
        }
        const person = selectPerson(scoped, { id: userId });
        if (!person) throw new Error("Mapped person missing");
        if (
          selectWeightByClient(scoped, {
            user_id: person.id,
            client_id: reading.clientId,
          })
        )
          return "duplicate";
        const problem = implausibility(scoped, person, reading);
        if (problem) {
          createQuestion(
            scoped,
            {
              userId: person.id,
              kind: "scale_implausible",
              subjectRef: reading.clientId,
              prompt: `Scale reading of ${Number(reading.weight_kg.toFixed(1))} kg at ${localTime(reading.measured_at, person.timezone)} ${problem}. Keep it?`,
              answerSchema: {
                ...zod.toJSONSchema(keepAnswer, {
                  target: "draft-7",
                  io: "input",
                }),
                scale_reading: {
                  measured_at: reading.measured_at,
                  weight_kg: reading.weight_kg,
                  body_fat_pct: reading.body_fat_pct,
                },
              },
            },
            clock,
            questionKinds,
          );
          return "question_implausible";
        }
        return acceptScaleReading(scope, person, reading, clock);
      });
    } catch (error) {
      return report(
        "failed",
        error instanceof Error ? error.name : "UnknownError",
      );
    }
    if (status === "logged") onLogged();
    return { status };
  };
}
