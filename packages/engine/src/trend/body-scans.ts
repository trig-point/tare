import { z as zod } from "zod";
import { emptyInput } from "../auth/routes.ts";
import { writeTransaction } from "../db.ts";
import { idInput } from "../logging/schemas.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { deleteBodyScan } from "../queries/body-scans/delete-body-scan.ts";
import { insertBodyScan } from "../queries/body-scans/insert-body-scan.ts";
import { selectBodyScans } from "../queries/body-scans/select-body-scans.ts";
import type { BodyFatReading } from "./body-fat.ts";

const percent = zod.number().min(0).max(100);
const mass = zod.number().min(0);
const regions = ["arms", "legs", "trunk", "android", "gynoid"] as const;
type OptionalField =
  | `${(typeof regions)[number]}_${"fat_pct" | "lean_kg"}`
  | "bone_density_g_cm2"
  | "t_score"
  | "note";

const requiredFields = {
  day: zod.iso.date(),
  method: zod.literal("dexa"),
  total_mass_kg: zod.number().positive(),
  body_fat_pct: percent,
  fat_mass_kg: mass,
  lean_mass_kg: mass,
  bone_mineral_kg: mass,
};
const nullableFields = {
  ...(Object.fromEntries(
    regions.flatMap((region) => [
      [`${region}_fat_pct`, percent.nullable()],
      [`${region}_lean_kg`, mass.nullable()],
    ]),
  ) as Record<
    Exclude<OptionalField, "bone_density_g_cm2" | "t_score" | "note">,
    zod.ZodNullable<zod.ZodNumber>
  >),
  bone_density_g_cm2: zod.number().positive().nullable(),
  t_score: zod.number().min(-10).max(10).nullable(),
  note: zod
    .string()
    .max(500)
    .refine((note) => !note.includes("\0") && !/[\uD800-\uDFFF]/u.test(note))
    .nullable(),
};
const optionalFields = Object.keys(nullableFields) as OptionalField[];
const scanInput = zod
  .strictObject({
    ...requiredFields,
    ...nullableFields,
  })
  .partial(
    Object.fromEntries(optionalFields.map((key) => [key, true])) as Record<
      OptionalField,
      true
    >,
  );
const scanRow = zod.strictObject({
  id: zod.number(),
  ...requiredFields,
  ...nullableFields,
});

const shared = {
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser_and_agent",
  admin: false,
} as const;

export const bodyScanOperations = [
  defineOperation({
    ...shared,
    name: "save_body_scan",
    description:
      "Save a body composition scan (DEXA) for a day. Masses in kg; regional fields, bone density, T-score and note are optional. One scan per day and method; delete it to replace it.",
    method: "POST",
    path: "/api/body-scans",
    bodyLimit: 8192,
    input: scanInput,
    inputIssues: true,
    output: zod.strictObject({ scan: scanRow }),
    handler(input, context) {
      const person = operationPerson(context);
      const filled = Object.fromEntries(
        optionalFields.map((key) => [key, input[key] ?? null]),
      ) as { [key in OptionalField]: zod.output<typeof scanRow>[key] };
      const scan = writeTransaction(context.database, () =>
        insertBodyScan(context.database, {
          ...input,
          ...filled,
          user_id: person.id,
          created_at: context.clock.now().toISOString(),
        }),
      );
      if (!scan) throw new OperationError(409, "scan_exists");
      return { status: 201, body: { scan } };
    },
  }),
  defineOperation({
    ...shared,
    name: "list_body_scans",
    description: "List body composition scans, oldest first.",
    method: "GET",
    path: "/api/body-scans",
    input: emptyInput,
    output: zod.strictObject({ scans: zod.array(scanRow) }),
    handler(_input, context) {
      return {
        status: 200,
        body: {
          scans: selectBodyScans(context.database, {
            user_id: operationPerson(context).id,
          }),
        },
      };
    },
  }),
  defineOperation({
    ...shared,
    name: "delete_body_scan",
    method: "DELETE",
    path: "/api/body-scans/:id",
    input: idInput,
    output: zod.strictObject({ deleted: zod.literal(true), id: zod.number() }),
    handler(input, context) {
      const [removed] = writeTransaction(context.database, () =>
        deleteBodyScan(context.database, {
          id: input.id,
          user_id: operationPerson(context).id,
        }),
      );
      if (!removed) throw new OperationError(404, "not_found");
      return { status: 200, body: { deleted: true, id: removed.id } };
    },
  }),
];

export const scanComparison = zod.strictObject({
  id: zod.number(),
  day: zod.iso.date(),
  method: zod.literal("dexa"),
  body_fat_pct: zod.number(),
  scale_reading_id: zod.number().nullable(),
  scale_body_fat_pct: zod.number().nullable(),
  gap_points: zod.number().nullable(),
});

/** Pairs each scan with the day's first scale reading; readings must be in day and time order. */
export function compareScans(
  scans: readonly {
    id: number;
    day: string;
    method: string;
    body_fat_pct: number;
  }[],
  readings: readonly BodyFatReading[],
) {
  return scans.map(({ id, day, method, body_fat_pct }) => {
    const reading = readings.find((candidate) => candidate.day === day);
    return {
      id,
      day,
      method,
      body_fat_pct,
      scale_reading_id: reading?.id ?? null,
      scale_body_fat_pct: reading?.body_fat_pct ?? null,
      gap_points: reading
        ? Math.round((reading.body_fat_pct - body_fat_pct) * 10) / 10
        : null,
    };
  });
}
