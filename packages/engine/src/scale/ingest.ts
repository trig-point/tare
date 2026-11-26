import { setTimeout as delay } from "node:timers/promises";
import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import type { Person } from "../auth/middleware.ts";
import { personDayBounds } from "../calendar/time.ts";
import type { ScaleConfig } from "../config.ts";
import {
  afterCommit,
  scopeDatabase,
  type WriteScope,
  writeTransaction,
} from "../db.ts";
import { canonicalInstant, localDay, shiftDay } from "../logging/day.ts";
import { insertWeight } from "../logging/weight.ts";
import { insertScaleReading } from "../queries/scale/insert-scale-reading.ts";
import { selectDayReceipt } from "../queries/scale/select-day-receipt.ts";
import { selectPriorFood } from "../queries/scale/select-prior-food.ts";
import { selectScaleReading } from "../queries/scale/select-scale-reading.ts";
import { selectSubjectQuestion } from "../queries/scale/select-subject-question.ts";
import { selectWeightsBefore } from "../queries/scale/select-weights-before.ts";
import { selectPerson } from "../queries/select-person.ts";
import { selectTodayWeights } from "../queries/select-today-weights.ts";
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
  | "question_unmapped"
  | "question_review"
  | "question_implausible";
export type ScaleResult =
  | { status: Stored | "ignored" }
  | { status: "invalid_input" | "failed"; reason: string };

const RETRY_DELAYS_MS = [100, 250, 500, 1000];
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

function logScaleWeight(
  scope: WriteScope,
  person: Person,
  reading: ScaleReading,
  clock: Clock,
  day: string,
) {
  return insertWeight(
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
    day,
  ).created;
}

function scaleDay(measuredAt: string, person: Person) {
  const instant = new Date(measuredAt);
  const candidate = localDay(
    measuredAt,
    person.timezone,
    person.day_start_hour,
  );
  const boundsFor = (day: string) =>
    personDayBounds(day, person.timezone, person.day_start_hour);
  const candidateBounds = boundsFor(candidate);
  const day =
    instant < candidateBounds.start
      ? shiftDay(candidate, -1)
      : instant >= candidateBounds.end
        ? shiftDay(candidate, 1)
        : candidate;
  const { start, end } = day === candidate ? candidateBounds : boundsFor(day);
  return { day, start: start.toISOString(), end: end.toISOString() };
}

function compareTrend(
  database: Database,
  person: Person,
  reading: ScaleReading,
  day: string,
) {
  const kg = (value: number) => `${Number(value.toFixed(1))} kg`;
  const history = selectWeightsBefore(database, {
    user_id: person.id,
    day,
    measured_at: reading.measured_at,
  });
  const instant = Date.parse(reading.measured_at);
  const recent = history.filter(
    (row) => instant - Date.parse(row.measured_at) <= TREND_MAX_AGE_MS,
  );
  const trend = weightTrend(recent).at(-1)?.trend_kg;
  const trendText =
    trend === undefined ? "No recent trend." : `Trend ${kg(trend)}.`;
  if (reading.weight_kg < MIN_KG || reading.weight_kg > MAX_KG)
    return {
      problem: `is outside ${MIN_KG} to ${MAX_KG} kg. ${trendText}`,
      trendText,
    };
  const problem =
    trend !== undefined &&
    Math.abs(reading.weight_kg - trend) > MAX_TREND_GAP_KG
      ? `is more than ${MAX_TREND_GAP_KG} kg from your trend of ${kg(trend)}.`
      : null;
  return { problem, trendText };
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
          const weight_logged =
            keepAnswer.parse(value).keep &&
            logScaleWeight(
              scope,
              person,
              { ...scale_reading, clientId: question.subject_ref },
              clock,
              selectScaleReading(database, {
                client_id: question.subject_ref,
              })?.day ??
                scaleDay(scale_reading.measured_at, person).day,
            );
          return { status: "applied", weight_logged };
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
  waitForRetry = delay,
  log = console.error,
  onLogged = () => {},
}: {
  database: Database;
  topic: string;
  users: ReadonlyMap<string, number>;
  questionKinds: ReadonlyMap<string, QuestionKind>;
  clock: Clock;
  waitForRetry?: (delayMs: number) => Promise<void>;
  log?: (code: string, detail?: string) => void;
  onLogged?: () => void;
}) {
  const counts = new Map<string, number>();
  const invalid = (reason: string): ScaleResult => {
    const count = (counts.get(reason) ?? 0) + 1;
    counts.set(reason, count);
    log("scale_reading_invalid", `${reason} ${count}`);
    return { status: "invalid_input", reason };
  };

  return async (payload: Buffer, topic: string): Promise<ScaleResult> => {
    if (topic === `${baseTopic}/status`) return { status: "ignored" };
    if (topic === baseTopic) return invalid("missing_slug");
    const slug = topic.slice(baseTopic.length + 1);
    const parsed = parsePayload(payload);
    if ("reason" in parsed) return invalid(parsed.reason);
    const reading = {
      ...parsed.reading,
      clientId: `scale:${slug}:${parsed.reading.measured_at}`,
    };
    const ingest = () =>
      writeTransaction(database, (scope): Stored => {
        const scoped = scopeDatabase(scope);
        if (
          selectSubjectQuestion(scoped, { subject_ref: reading.clientId }) ||
          selectScaleReading(scoped, { client_id: reading.clientId })
        )
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
        const measuredDay = scaleDay(reading.measured_at, person);
        const ownerDay = { user_id: userId, day: measuredDay.day };
        const { problem, trendText } = compareTrend(
          scoped,
          person,
          reading,
          measuredDay.day,
        );
        const autoLog =
          problem === null &&
          !selectDayReceipt(scoped, {
            ...ownerDay,
            start: measuredDay.start,
            end: measuredDay.end,
          }) &&
          selectTodayWeights(scoped, ownerDay).length === 0 &&
          selectPriorFood(scoped, {
            ...ownerDay,
            measured_at: reading.measured_at,
          }).length === 0;
        insertScaleReading(scoped, {
          ...ownerDay,
          client_id: reading.clientId,
          created_at: clock.now().toISOString(),
        });
        if (autoLog) {
          if (!logScaleWeight(scope, person, reading, clock, measuredDay.day))
            throw new Error("Scale weight already exists");
          afterCommit(scope, onLogged, () => log("scale_refresh_failed"));
          return "logged";
        }
        const amount = Number(reading.weight_kg.toFixed(1));
        const time = localTime(reading.measured_at, person.timezone);
        createQuestion(
          scoped,
          {
            userId: person.id,
            kind: "scale_implausible",
            subjectRef: reading.clientId,
            prompt: `Scale reading of ${amount} kg at ${time}${problem ? ` ${problem}` : `. ${trendText}`} Keep it?`,
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
        return problem ? "question_implausible" : "question_review";
      });

    const failed = (error: unknown): ScaleResult => {
      const reason =
        errorCode(error) ??
        (error instanceof Error ? error.name : "UnknownError");
      log(
        "scale_reading_failed",
        `${reason} ${reading.weight_kg} kg at ${reading.measured_at}`,
      );
      return { status: "failed", reason };
    };
    for (let attempt = 0; ; attempt++) {
      const retryDelay = RETRY_DELAYS_MS[attempt];
      try {
        return { status: tryWithoutBusyWait(database, ingest) };
      } catch (error) {
        const code = errorCode(error)?.split("_", 2).join("_");
        if (
          retryDelay === undefined ||
          (code !== "SQLITE_BUSY" && code !== "SQLITE_LOCKED")
        )
          return failed(error);
      }
      try {
        await waitForRetry(retryDelay);
      } catch (error) {
        return failed(error);
      }
    }
  };
}

function errorCode(error: unknown) {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function tryWithoutBusyWait<Result>(database: Database, attempt: () => Result) {
  const timeout = database.pragma("busy_timeout", { simple: true });
  database.pragma("busy_timeout = 0");
  try {
    return attempt();
  } finally {
    database.pragma(`busy_timeout = ${Number(timeout)}`);
  }
}
