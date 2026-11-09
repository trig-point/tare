import type { Database } from "better-sqlite3";
import type { z as zod } from "zod";
import { personDayBounds } from "../calendar/time.ts";
import { writeTransaction } from "../db.ts";
import { OperationError } from "../operations/registry.ts";
import { eatMealInput, eatOrderMeal } from "../orders/eat.ts";
import { isDue } from "../orders/index.ts";
import { selectInstallId } from "../queries/home-assistant/select-install-id.ts";
import { listMealCandidates } from "../queries/orders/list-meal-candidates.ts";
import { selectPerson } from "../queries/select-person.ts";
import type { EntityDefinition, Person, Provider } from "./discovery.ts";
import { type PublisherClock, systemClock } from "./publisher.ts";

const actions = [
  ["ate", "ate it"],
  ["ate_three_quarters", "ate 3/4"],
] as const;

const pressPayload = eatMealInput.omit({ mutation_id: true });

export const pressTopic = (install: string, userId: number) =>
  `tare/${install}/${userId}/meal_press`;
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
  clock?: PublisherClock;
  log?: (code: string, detail?: string) => void;
}) {
  const install = selectInstallId(database)?.id ?? "";
  if (!install) throw new Error("Install id missing");
  const results = new Map<number, string>();
  const subscribed = new Set<number>();
  const timers = new Map<number, { at: number; cancel(): void }>();

  function press(userId: number, payload: Buffer) {
    const now = clock.now().toISOString();
    let parsed: zod.infer<typeof pressPayload> | undefined;
    let result: string;
    try {
      parsed = pressPayload.parse(JSON.parse(payload.toString()));
      const person = selectPerson(database, { id: userId });
      if (!person) return;
      const input = {
        ...parsed,
        mutation_id: `ha:${userId}:${parsed.meal_id}:${parsed.action}:${parsed.revision}`,
      };
      writeTransaction(database, (scope) =>
        eatOrderMeal(scope, person, input, now),
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
    results.set(
      userId,
      JSON.stringify({
        result,
        meal_id: parsed?.meal_id ?? null,
        action: parsed?.action ?? null,
        at: now,
      }),
    );
    publisher.refreshAll();
  }

  function armDeliveryTimer(person: Person, pending: string[]) {
    const next = pending.sort()[0];
    const at = next
      ? personDayBounds(next, person.timezone, person.day_start_hour).start
      : undefined;
    const current = timers.get(person.id);
    if (current?.at === at?.getTime()) return;
    current?.cancel();
    timers.delete(person.id);
    if (!at) return;
    const timer = clock.schedule(
      () => {
        timers.delete(person.id);
        publisher.refreshAll();
      },
      Math.max(0, at.getTime() - clock.now().getTime()),
    );
    timers.set(person.id, { at: at.getTime(), cancel: timer.cancel });
  }

  const provider: Provider = (person) => {
    if (!subscribed.has(person.id)) {
      subscribed.add(person.id);
      publisher.subscribe(pressTopic(install, person.id), (payload) =>
        press(person.id, payload),
      );
    }
    const now = clock.now().toISOString();
    const meals = listMealCandidates(database, { user_id: person.id });
    const onHand = meals.filter((meal) => isDue(meal, person, now));
    armDeliveryTimer(
      person,
      meals
        .filter((meal) => !isDue(meal, person, now))
        .map((meal) => meal.delivery_date),
    );
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

  return {
    provider,
    stop() {
      for (const timer of timers.values()) timer.cancel();
      timers.clear();
    },
  };
}

const errorName = (error: unknown) =>
  error instanceof Error ? error.name : "UnknownError";
