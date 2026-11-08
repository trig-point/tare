import { z as zod } from "zod";
import { writeTransaction } from "../db.ts";
import { localDay } from "../logging/day.ts";
import {
  defineOperation,
  type OperationContext,
  OperationError,
  operationPerson,
} from "../operations/registry.ts";
import {
  actOnPlannedItem,
  plannedItemActionInput,
  plannedItemActionOutput,
} from "../orders/eat.ts";
import { clearIntakeSlots } from "../queries/clear-intake-slots.ts";
import { countSignedOffDays } from "../queries/count-signed-off-days.ts";
import { deleteDayTemplate } from "../queries/delete-day-template.ts";
import { deleteDayType } from "../queries/delete-day-type.ts";
import { deleteTemplateSlots } from "../queries/delete-template-slots.ts";
import { detachPlannedItems } from "../queries/detach-planned-items.ts";
import { insertDayTemplate } from "../queries/insert-day-template.ts";
import { insertDayType } from "../queries/insert-day-type.ts";
import { insertTemplateSlot } from "../queries/insert-template-slot.ts";
import { selectDayTemplate } from "../queries/select-day-template.ts";
import { selectDayType } from "../queries/select-day-type.ts";
import { selectLedgerEntries } from "../queries/select-ledger-entries.ts";
import { selectSignedOffIntake } from "../queries/select-signed-off-intake.ts";
import { selectTemplateSlots } from "../queries/select-template-slots.ts";
import { setDayType } from "../queries/set-day-type.ts";
import { setDefaultDayType } from "../queries/set-default-day-type.ts";
import { updateDayTemplate } from "../queries/update-day-template.ts";
import { updateDayType } from "../queries/update-day-type.ts";
import { updateSlotShare } from "../queries/update-slot-share.ts";
import { readTarget } from "../target/reader.ts";
import { planSlot, readPlannedItems } from "./items.ts";
import { selectedTemplate } from "./reader.ts";
import {
  budgetStatus,
  dayTypeSchema,
  identifier,
  plannedItemSchema,
  planSchema,
  planSlotInput,
  saveSharesInput,
  saveTemplateInput,
  saveTypeInput,
  slotBudgetSchema,
  slotSchema,
  templateSchema,
  validateSlots,
} from "./schema.ts";
import {
  assignSlot,
  minuteOfDay,
  slotBudgets,
  suggestShares,
} from "./slots.ts";

function readPlan(context: OperationContext) {
  const person = operationPerson(context);
  const now = context.clock.now();
  const day = localDay(
    now.toISOString(),
    person.timezone,
    person.day_start_hour,
  );
  const plan = selectedTemplate(context.database, person, day, now);
  const target = readTarget(context.database, person, now, context.config.tdee);
  const status = plan.status === "no_day_type" ? plan.status : target.status;
  const budgets =
    status === "ready" && target.status === "ready"
      ? {
          status,
          target: { kcal: target.kcal, protein_g: target.protein_g },
          slots: slotBudgets(
            plan.slots,
            selectLedgerEntries(context.database, { user_id: person.id, day }),
            target,
            day,
            now.toISOString(),
            person,
          ),
        }
      : { status, target: null, slots: [] };
  return { ...plan, budgets };
}

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
      const body = restricted("template_in_use", () =>
        writeTransaction(context.database, () => {
          const user_id = operationPerson(context).id;
          if (input.action !== "create") {
            owned(selectDayTemplate(context.database, { user_id, id }));
            // Saves reuse positions and a deleted id can return, so stored
            // links would name another window; reads reassign these by time.
            clearIntakeSlots(context.database, { user_id, template_id: id });
            detachPlannedItems(
              context.database,
              { updated_at: context.clock.now().toISOString() },
              { user_id, template_id: id },
            );
          }
          if (input.action !== "delete") validateSlots(slots);
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
    name: "save_slot_shares",
    path: "/api/plan/shares",
    input: saveSharesInput,
    output: zod.strictObject({ slots: zod.array(slotSchema).min(1) }),
    handler(input, context) {
      const slots = writeTransaction(context.database, () => {
        const key = {
          user_id: operationPerson(context).id,
          template_id: input.template_id,
        };
        owned(
          selectDayTemplate(context.database, {
            user_id: key.user_id,
            id: key.template_id,
          }),
        );
        const current = selectTemplateSlots(context.database, key);
        const positions = input.shares
          .map((value) => value.position)
          .toSorted((left, right) => left - right);
        if (
          positions.length !== current.length ||
          current.some((slot, index) => slot.position !== positions[index])
        )
          throw new OperationError(400, "slot_positions_mismatch");
        const share = (position: number) =>
          input.shares.find((value) => value.position === position)
            ?.share as number;
        validateSlots(
          current.map((slot) => ({
            name: slot.name,
            start_minute: slot.start_minute,
            end_minute: slot.end_minute,
            share: share(slot.position),
          })),
        );
        for (const slot of current)
          updateSlotShare(
            context.database,
            { share_bp: Math.round(share(slot.position) * 100) },
            { ...key, position: slot.position },
          );
        return selectTemplateSlots(context.database, key);
      });
      return { status: 200, body: { slots } };
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
      return {
        status: 200,
        body: readPlan(context),
      };
    },
  }),
  defineOperation({
    ...write,
    name: "plan_slot",
    path: "/api/plan/slot",
    input: planSlotInput,
    output: zod.strictObject({ item: plannedItemSchema }),
    handler: planSlot,
  }),
  defineOperation({
    ...write,
    name: "planned_item_action",
    path: "/api/plan/items/action",
    bodyLimit: 8192,
    input: plannedItemActionInput,
    output: plannedItemActionOutput,
    handler(input, context) {
      return writeTransaction(context.database, (scope) => ({
        status: 200,
        body: actOnPlannedItem(
          scope,
          operationPerson(context),
          input,
          context.clock.now().toISOString(),
        ),
      }));
    },
  }),
  defineOperation({
    ...shared,
    name: "read_plan",
    method: "GET",
    path: "/api/plan",
    input: zod.strictObject({}),
    output: planSchema.safeExtend({
      planned_items: zod.array(plannedItemSchema),
      suggested_shares: zod
        .array(
          zod.strictObject({
            position: zod.number().int().nonnegative(),
            share: zod.number().int().min(1).max(100),
          }),
        )
        .nullable(),
    }),
    handler(_input, context) {
      const plan = readPlan(context);
      const person = operationPerson(context);
      const user_id = { user_id: person.id };
      const signedOff = countSignedOffDays(context.database, user_id);
      if (!signedOff) throw new Error("Signed-off day count returned no row");
      return {
        status: 200,
        body: {
          ...plan,
          suggested_shares: suggestShares(
            plan.slots,
            selectSignedOffIntake(context.database, user_id),
            signedOff.count,
            person,
          ),
          planned_items: plan.template
            ? readPlannedItems(
                context.database,
                person.id,
                plan.day,
                plan.template.id,
              )
            : [],
        },
      };
    },
  }),
  defineOperation({
    ...shared,
    name: "next_slot",
    method: "GET",
    path: "/api/plan/next-slot",
    input: zod.strictObject({}),
    output: zod.strictObject({
      status: budgetStatus,
      slot: slotBudgetSchema.nullable(),
    }),
    handler(_input, context) {
      const plan = readPlan(context);
      const open = plan.slots.filter((slot) =>
        plan.budgets.slots.some(
          (row) => row.position === slot.position && !row.ended,
        ),
      );
      const next = assignSlot(
        open,
        minuteOfDay(
          context.clock.now().toISOString(),
          operationPerson(context),
        ),
      );
      return {
        status: 200,
        body: {
          status: plan.budgets.status,
          slot:
            plan.budgets.slots.find(
              (slot) => slot.position === next?.position,
            ) ?? null,
        },
      };
    },
  }),
];
