import { z as zod } from "zod";
import { writeTransaction } from "../db.ts";
import { localDay } from "../logging/day.ts";
import {
  defineOperation,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import { deleteDayTemplate } from "../queries/delete-day-template.ts";
import { deleteDayType } from "../queries/delete-day-type.ts";
import { deleteTemplateSlots } from "../queries/delete-template-slots.ts";
import { insertDayTemplate } from "../queries/insert-day-template.ts";
import { insertDayType } from "../queries/insert-day-type.ts";
import { insertTemplateSlot } from "../queries/insert-template-slot.ts";
import { selectDayTemplate } from "../queries/select-day-template.ts";
import { selectDayType } from "../queries/select-day-type.ts";
import { selectTemplateSlots } from "../queries/select-template-slots.ts";
import { setDayType } from "../queries/set-day-type.ts";
import { setDefaultDayType } from "../queries/set-default-day-type.ts";
import { updateDayTemplate } from "../queries/update-day-template.ts";
import { updateDayType } from "../queries/update-day-type.ts";
import { selectedTemplate } from "./reader.ts";
import {
  dayTypeSchema,
  identifier,
  planSchema,
  saveTemplateInput,
  saveTypeInput,
  slotSchema,
  templateSchema,
  validateSlots,
} from "./schema.ts";

const shared = {
  modes: ["access", "fallback"] as ("access" | "fallback")[],
  callerClass: "browser_and_agent",
  admin: false,
} as const;
const write = { ...shared, method: "POST", bodyLimit: 16384 } as const;
function owned<Value>(value: Value | null): Value {
  if (value === null) throw new OperationError(404, "not_found");
  return value;
}
function restricted<Result>(code: string, callback: () => Result): Result {
  try {
    return callback();
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "SQLITE_CONSTRAINT_FOREIGNKEY"
    )
      throw new OperationError(409, code);
    throw error;
  }
}
export const planOperations = [
  defineOperation({
    ...write,
    name: "save_day_template",
    path: "/api/plan/templates",
    input: saveTemplateInput,
    output: zod
      .strictObject({
        deleted: zod.literal(true).optional(),
        template: templateSchema.optional(),
        slots: zod.array(slotSchema).min(1).optional(),
      })
      .refine((body) =>
        body.deleted === true
          ? body.template === undefined && body.slots === undefined
          : body.template !== undefined && body.slots !== undefined,
      ),
    handler(input, context) {
      const id = input.id as number;
      const name = input.name as string;
      const slots = input.slots as NonNullable<typeof input.slots>;
      if (input.action !== "delete") validateSlots(slots);
      const body = restricted("template_in_use", () =>
        writeTransaction(context.database, () => {
          const user_id = operationPerson(context).id;
          if (input.action !== "create")
            owned(selectDayTemplate(context.database, { user_id, id }));
          if (input.action === "delete") {
            deleteTemplateSlots(context.database, {
              user_id,
              template_id: id,
            });
            deleteDayTemplate(context.database, { user_id, id });
            return { deleted: true };
          }
          const template =
            input.action === "create"
              ? insertDayTemplate(context.database, {
                  user_id,
                  name,
                  created_at: context.clock.now().toISOString(),
                })
              : updateDayTemplate(context.database, { name }, { user_id, id });
          if (!template) throw new Error("Template save returned no row");
          const key = { user_id, template_id: template.id };
          deleteTemplateSlots(context.database, key);
          slots.forEach((slot, position) =>
            insertTemplateSlot(context.database, {
              ...key,
              position,
              name: slot.name,
              start_minute: slot.start_minute,
              end_minute: slot.end_minute,
              share_bp: Math.round(slot.share * 100),
              fill_hint: slot.fill_hint ?? null,
            }),
          );
          return {
            template,
            slots: selectTemplateSlots(context.database, key),
          };
        }),
      );
      return { status: input.action === "create" ? 201 : 200, body };
    },
  }),
  defineOperation({
    ...write,
    name: "save_day_type",
    path: "/api/plan/day-types",
    input: saveTypeInput,
    output: zod
      .strictObject({
        deleted: zod.literal(true).optional(),
        day_type: dayTypeSchema.optional(),
      })
      .refine(
        (body) =>
          (body.deleted === undefined) !== (body.day_type === undefined),
      ),
    handler(input, context) {
      const id = input.id as number;
      const body = restricted("day_type_in_use", () =>
        writeTransaction(context.database, () => {
          const user_id = operationPerson(context).id;
          if (input.action !== "create")
            owned(selectDayType(context.database, { user_id, id }));
          if (input.action === "delete") {
            deleteDayType(context.database, { user_id, id });
            return { deleted: true };
          }
          owned(
            selectDayTemplate(context.database, {
              user_id,
              id: input.template_id as number,
            }),
          );
          const values = {
            name: input.name as string,
            template_id: input.template_id as number,
          };
          const day_type =
            input.action === "create"
              ? insertDayType(context.database, { user_id, ...values })
              : updateDayType(context.database, values, {
                  user_id,
                  id,
                });
          if (!day_type) throw new Error("Day type save returned no row");
          return { day_type };
        }),
      );
      return { status: input.action === "create" ? 201 : 200, body };
    },
  }),
  defineOperation({
    ...write,
    name: "set_default_day_type",
    path: "/api/plan/default-day-type",
    input: zod.strictObject({ day_type_id: identifier }),
    output: zod.strictObject({ day_type: dayTypeSchema }),
    handler(input, context) {
      const day_type = writeTransaction(context.database, () => {
        const user_id = operationPerson(context).id;
        const row = owned(
          selectDayType(context.database, { user_id, id: input.day_type_id }),
        );
        setDefaultDayType(context.database, { user_id, ...input });
        return row;
      });
      return { status: 200, body: { day_type } };
    },
  }),
  defineOperation({
    ...write,
    name: "set_day_type",
    path: "/api/plan/day-type",
    input: zod.strictObject({
      day_type_id: identifier,
      day: zod.iso.date().optional(),
    }),
    output: zod.strictObject({ day: zod.iso.date(), day_type: dayTypeSchema }),
    handler(input, context) {
      const person = operationPerson(context);
      const day =
        input.day ??
        localDay(
          context.clock.now().toISOString(),
          person.timezone,
          person.day_start_hour,
        );
      const day_type = writeTransaction(context.database, () => {
        const row = owned(
          selectDayType(context.database, {
            user_id: person.id,
            id: input.day_type_id,
          }),
        );
        setDayType(context.database, {
          user_id: person.id,
          day,
          day_type_id: row.id,
        });
        return row;
      });
      return { status: 200, body: { day, day_type } };
    },
  }),
  defineOperation({
    ...shared,
    name: "read_day_plan",
    method: "GET",
    path: "/api/plan/today",
    input: zod.strictObject({}),
    output: planSchema,
    handler(_input, context) {
      const person = operationPerson(context);
      const day = localDay(
        context.clock.now().toISOString(),
        person.timezone,
        person.day_start_hour,
      );
      return {
        status: 200,
        body: selectedTemplate(context.database, person, day),
      };
    },
  }),
];
