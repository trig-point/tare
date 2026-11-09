import type { Database } from "better-sqlite3";
import type { z as zod } from "zod";
import { writeTransaction } from "../db.ts";
import { localDay } from "../logging/day.ts";
import { OperationError } from "../operations/registry.ts";
import {
  actOnPlannedItem,
  eatMealInput,
  eatOrderMeal,
  plannedItemActionInput,
} from "../orders/eat.ts";
import { listMealsOnHand } from "../orders/index.ts";
import { readPlannedItems } from "../plan/items.ts";
import { selectedTemplate } from "../plan/reader.ts";
import { selectInstallId } from "../queries/home-assistant/select-install-id.ts";
import { selectPerson } from "../queries/select-person.ts";
import type { EntityDefinition, Person, Provider } from "./discovery.ts";
import { systemClock } from "./publisher.ts";

const actions = [
  ["ate", "ate it"],
  ["ate_three_quarters", "ate 3/4"],
] as const;

const planActions = [...actions, ["skip", "skip"]] as const;

const pressPayload = eatMealInput.omit({ mutation_id: true });
const planPressPayload = plannedItemActionInput.omit({ mutation_id: true });

export const pressTopic = (install: string, userId: number) =>
  `tare/${install}/${userId}/meal_press`;
export const planPressTopic = (install: string, userId: number) =>
  `tare/${install}/${userId}/plan_press`;
export const pressResultTopic = (install: string, userId: number) =>
  `tare/${install}/${userId}/meal_press_result`;

export function createMealButtons({
  database,
  publisher,
  clock = systemClock,
  log = console.error,
}: {
  database: Database;
  publisher: {
    refreshAll(): void;
    subscribe(topic: string, handler: (payload: Buffer) => void): void;
  };
  clock?: { now(): Date };
  log?: (code: string, detail?: string) => void;
}) {
  const install = selectInstallId(database)?.id ?? "";
  if (!install) throw new Error("Install id missing");
  const results = new Map<number, string>();
  const subscribed = new Set<number>();

  function press(userId: number, payload: Buffer, planned: boolean) {
    const now = clock.now().toISOString();
    let parsed:
      | zod.infer<typeof pressPayload>
      | zod.infer<typeof planPressPayload>
      | undefined;
    let result: string;
    try {
      const body = JSON.parse(payload.toString());
      parsed = (planned ? planPressPayload : pressPayload).parse(body);
      const person = selectPerson(database, { id: userId });
      if (!person) return;
      const fields = parsed;
      writeTransaction(database, (scope) =>
        "item_id" in fields
          ? actOnPlannedItem(
              scope,
              person,
              {
                ...fields,
                mutation_id: `ha:plan:${userId}:${fields.item_id}:${fields.action}:${fields.revision}`,
              },
              now,
            )
          : eatOrderMeal(
              scope,
              person,
              {
                ...fields,
                mutation_id: `ha:${userId}:${fields.meal_id}:${fields.action}:${fields.revision}`,
              },
              now,
            ),
      );
      result = "logged";
    } catch (error) {
      if (error instanceof OperationError) result = error.code;
      else if (!parsed) result = "invalid_press";
      else {
        result = "failed";
        log("home_assistant_press_failed", errorName(error));
      }
    }
    const target = planned
      ? { item_id: parsed && "item_id" in parsed ? parsed.item_id : null }
      : { meal_id: parsed && "meal_id" in parsed ? parsed.meal_id : null };
    results.set(
      userId,
      JSON.stringify({
        result,
        ...target,
        action: parsed?.action ?? null,
        at: now,
      }),
    );
    publisher.refreshAll();
  }

  function plannedButtons(person: Person, instant: Date) {
    const day = localDay(
      instant.toISOString(),
      person.timezone,
      person.day_start_hour,
    );
    const plan = selectedTemplate(database, person, day, instant);
    if (!plan.template) return [];
    const slotName = new Map(
      plan.slots.map((slot) => [slot.position, slot.name]),
    );
    return readPlannedItems(database, person.id, day, plan.template.id)
      .filter((item) => item.state === "planned")
      .flatMap((item) =>
        planActions.map(
          ([action, label]): EntityDefinition => ({
            component: "button",
            key: `plan_${item.id}_${action}`,
            config: {
              name: `${slotName.get(item.position)}: ${item.reference.name} ${label}`,
              command_topic: planPressTopic(install, person.id),
              payload_press: JSON.stringify({
                item_id: item.id,
                revision: item.revision,
                action,
              }),
              qos: 1,
              retain: false,
            },
          }),
        ),
      );
  }

  const provider: Provider = (person) => {
    if (!subscribed.has(person.id)) {
      subscribed.add(person.id);
      publisher.subscribe(pressTopic(install, person.id), (payload) =>
        press(person.id, payload, false),
      );
      publisher.subscribe(planPressTopic(install, person.id), (payload) =>
        press(person.id, payload, true),
      );
    }
    const instant = clock.now();
    const onHand = listMealsOnHand(database, person, instant.toISOString());
    const resultTopic = pressResultTopic(install, person.id);
    const buttons = onHand.flatMap((meal) =>
      actions.map(
        ([action, label]): EntityDefinition => ({
          component: "button",
          key: `meal_${meal.id}_${action}`,
          config: {
            name: `${meal.name} ${label}`,
            command_topic: pressTopic(install, person.id),
            payload_press: JSON.stringify({
              meal_id: meal.id,
              revision: meal.revision,
              action,
            }),
            qos: 1,
            retain: false,
          },
        }),
      ),
    );
    return {
      entities: [
        ...buttons,
        ...plannedButtons(person, instant),
        {
          component: "sensor",
          key: "meal_press_result",
          config: {
            name: "Last meal press",
            state_topic: resultTopic,
            value_template: "{{ value_json.result }}",
            json_attributes_topic: resultTopic,
          },
        },
      ],
      state: {
        [resultTopic]:
          results.get(person.id) ??
          JSON.stringify({ result: "none", meal_id: null, action: null }),
      },
    };
  };

  return { provider };
}

const errorName = (error: unknown) =>
  error instanceof Error ? error.name : "UnknownError";
