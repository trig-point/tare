import { z as zod } from "zod";
import { writeTransaction } from "../db.ts";
import { localDay } from "../logging/day.ts";
import {
  defineOperation,
  type OperationContext,
  OperationError,
  type OperationResult,
  operationPerson,
} from "../operations/registry.ts";
import { selectBodyUnits } from "../queries/select-body-units.ts";
import { selectProfile } from "../queries/select-profile.ts";
import { updateBodyUnits } from "../queries/update-body-units.ts";
import { upsertProfile } from "../queries/upsert-profile.ts";
import { ageYears } from "../target/formula.ts";
import { recomputeTarget } from "../target/recompute.ts";
import {
  bodyUnits,
  profileInput,
  profilePatch,
  profileSchema,
} from "./schema.ts";

const shared = {
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser_and_agent",
  admin: false,
} as const;

function writeProfile(
  input: zod.infer<typeof profilePatch>,
  context: OperationContext,
  patch: boolean,
): OperationResult {
  const person = operationPerson(context);
  const now = context.clock.now().toISOString();
  const profile = writeTransaction(context.database, (scope) => {
    const stored = selectProfile(context.database, { user_id: person.id });
    if (patch && !stored) throw new OperationError(404, "not_found");
    if (patch && stored && Object.keys(input).length === 0) return stored;
    const fields = profileInput.safeParse({
      protein_factor: 1.6,
      ...(patch &&
        stored && {
          protein_factor: stored.protein_factor,
          height_cm: stored.height_cm,
          birth_date: stored.birth_date,
          sex: stored.sex,
          activity_level: stored.activity_level,
          goal_rate_kg_week: stored.goal_rate_kg_week,
        }),
      ...input,
    });
    if (!fields.success) throw new OperationError(400, "invalid_request");
    const age = ageYears(
      fields.data.birth_date,
      localDay(now, person.timezone, person.day_start_hour),
    );
    if (age < 18 || age > 120) throw new OperationError(400, "invalid_request");
    const profile = upsertProfile(context.database, {
      ...fields.data,
      user_id: person.id,
      updated_at: now,
    });
    if (!profile) throw new Error("Profile save returned no row");
    recomputeTarget(
      scope,
      person,
      new Date(now),
      context.config.tdee,
      "profile",
    );
    return profile;
  });
  return { status: 200, body: { profile } };
}

export const profileOperations = [
  defineOperation({
    ...shared,
    name: "save_profile",
    method: "POST",
    path: "/api/profile",
    bodyLimit: 8192,
    input: profileInput.extend({
      protein_factor: profileInput.shape.protein_factor.default(1.6),
    }),
    output: zod.strictObject({ profile: profileSchema }),
    handler: (input, context) => writeProfile(input, context, false),
  }),
  defineOperation({
    ...shared,
    callerClass: "browser",
    name: "update_profile",
    method: "PATCH",
    path: "/api/profile",
    bodyLimit: 8192,
    input: profilePatch,
    output: zod.strictObject({ profile: profileSchema }),
    handler: (input, context) => writeProfile(input, context, true),
  }),
  defineOperation({
    ...shared,
    name: "read_profile",
    method: "GET",
    path: "/api/profile",
    input: zod.strictObject({}),
    output: zod.strictObject({ profile: profileSchema.nullable() }),
    handler(_input, context) {
      return {
        status: 200,
        body: {
          profile:
            selectProfile(context.database, {
              user_id: operationPerson(context).id,
            }) ?? null,
        },
      };
    },
  }),
  defineOperation({
    ...shared,
    callerClass: "browser",
    name: "read_body_units",
    method: "GET",
    path: "/api/profile/units",
    input: zod.strictObject({}),
    output: zod.strictObject({ units: bodyUnits }),
    handler(_input, context) {
      const [row] = selectBodyUnits(context.database, {
        user_id: operationPerson(context).id,
      });
      if (!row) throw new Error("Units read returned no row");
      return { status: 200, body: { units: bodyUnits.parse(row.body_units) } };
    },
  }),
  defineOperation({
    ...shared,
    callerClass: "browser",
    name: "save_body_units",
    method: "POST",
    path: "/api/profile/units",
    bodyLimit: 1024,
    input: zod.strictObject({ units: bodyUnits }),
    output: zod.strictObject({ units: bodyUnits }),
    handler(input, context) {
      const [row] = updateBodyUnits(
        context.database,
        { body_units: input.units },
        { user_id: operationPerson(context).id },
      );
      if (!row) throw new Error("Units save returned no row");
      return { status: 200, body: { units: bodyUnits.parse(row.body_units) } };
    },
  }),
];
