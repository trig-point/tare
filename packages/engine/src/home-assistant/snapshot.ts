import type { Database } from "better-sqlite3";
import type { Config } from "../config.ts";
import { readLedger, remainingFor } from "../days/ledger.ts";
import { localDay } from "../logging/day.ts";
import { selectTargetWeights } from "../queries/select-target-weights.ts";
import { readTarget } from "../target/reader.ts";
import { weightTrend } from "../trend/weight-trend.ts";
import type { EntityDefinition, Person, Provider } from "./discovery.ts";

type TargetConfig = Pick<
  Config,
  "tdee" | "activityCredit" | "activityBonusCap"
>;

const sensors = [
  ["calorie_target", "Calorie target", "kcal"],
  ["protein_target", "Protein target", "g"],
  ["calories_remaining", "Calories remaining", "kcal"],
  ["protein_remaining", "Protein remaining", "g"],
  ["calories_eaten", "Calories eaten today", "kcal", "kcal_complete"],
  ["protein_eaten", "Protein eaten today", "g", "protein_complete"],
  ["weight_trend", "Weight trend", "kg"],
] as const;

export function personSnapshot(
  database: Database,
  person: Person,
  now: Date,
  settings: TargetConfig,
) {
  const day = localDay(
    now.toISOString(),
    person.timezone,
    person.day_start_hour,
  );
  const { totals } = readLedger(database, person.id, day);
  const target = readTarget(database, person, now, settings);
  const ready = target.status === "ready" ? target : undefined;
  return {
    calorie_target: ready?.kcal ?? null,
    protein_target: ready?.protein_g ?? null,
    calories_remaining: remainingFor(target, totals, "kcal"),
    protein_remaining: remainingFor(target, totals, "protein_g"),
    calories_eaten: totals.kcal.known_subtotal,
    protein_eaten: totals.protein_g.known_subtotal,
    weight_trend:
      weightTrend(
        selectTargetWeights(database, { user_id: person.id, day }),
      ).at(-1)?.trend_kg ?? null,
    kcal_complete: totals.kcal.complete,
    protein_complete: totals.protein_g.complete,
  };
}

export function sensorProvider(
  database: Database,
  clock: { now(): Date },
  settings: TargetConfig,
): Provider {
  return (person, topics) => ({
    entities: sensors.map(
      ([key, name, unit, completeKey]): EntityDefinition => ({
        component: "sensor",
        key,
        config: {
          name,
          state_topic: topics.state,
          value_template: `{{ value_json.${key} }}`,
          unit_of_measurement: unit,
          state_class: "measurement",
          ...(key === "weight_trend" ? { device_class: "weight" } : {}),
          ...(completeKey
            ? {
                json_attributes_topic: topics.state,
                json_attributes_template: `{{ {'complete': value_json.${completeKey}} | tojson }}`,
              }
            : {}),
        },
      }),
    ),
    state: {
      [topics.state]: JSON.stringify(
        personSnapshot(database, person, clock.now(), settings),
      ),
    },
  });
}
