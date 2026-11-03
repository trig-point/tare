import { z as zod } from "zod";
import { writeTransaction } from "../db.ts";
import { defineOperation, operationPerson } from "../operations/registry.ts";
import { selectProfile } from "../queries/select-profile.ts";
import { upsertProfile } from "../queries/upsert-profile.ts";
import { profileInput, profileSchema } from "./schema.ts";

const shared = {
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser_and_agent",
  admin: false,
} as const;

export const profileOperations = [
  defineOperation({
    ...shared,
    name: "save_profile",
    method: "POST",
    path: "/api/profile",
    bodyLimit: 8192,
    input: profileInput,
    output: zod.strictObject({ profile: profileSchema }),
    handler(input, context) {
      const profile = writeTransaction(context.database, () =>
        upsertProfile(context.database, {
          ...input,
          user_id: operationPerson(context).id,
          updated_at: context.clock.now().toISOString(),
        }),
      );
      if (!profile) throw new Error("Profile save returned no row");
      return { status: 200, body: { profile } };
    },
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
];
