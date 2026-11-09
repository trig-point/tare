import type { Database } from "better-sqlite3";
import { connect, type IClientOptions, type MqttClient } from "mqtt";
import { personDayBounds } from "../calendar/time.ts";
import type { MqttConfig } from "../config.ts";
import { localDay } from "../logging/day.ts";
import { deleteHaEntity } from "../queries/home-assistant/delete-ha-entity.ts";
import { insertHaEntity } from "../queries/home-assistant/insert-ha-entity.ts";
import { listHaEntities } from "../queries/home-assistant/list-ha-entities.ts";
import { listPeople } from "../queries/home-assistant/list-people.ts";
import { selectInstallId } from "../queries/home-assistant/select-install-id.ts";
import {
  availabilityTopic,
  discoveryMessage,
  entitySlugs,
  type Person,
  type Provider,
  stateTopic,
} from "./discovery.ts";

export interface PublisherClock {
  now(): Date;
  schedule(callback: () => void, delayMs: number): { cancel(): void };
}

export const systemClock: PublisherClock = {
  now: () => new Date(),
  schedule(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    return { cancel: () => clearTimeout(handle) };
  },
};

export type HomeAssistantPublisher = ReturnType<
  typeof createHomeAssistantPublisher
>;

const errorName = (error: unknown) =>
  error instanceof Error ? error.name : "UnknownError";

export function createHomeAssistantPublisher({
  database,
  config,
  clock = systemClock,
  graceMs = 5000,
  clientOptions = {},
  log = console.error,
}: {
  database: Database;
  config: MqttConfig;
  clock?: PublisherClock;
  graceMs?: number;
  clientOptions?: IClientOptions;
  log?: (code: string, detail?: string) => void;
}) {
  const install = selectInstallId(database)?.id ?? "";
  if (!install) throw new Error("Install id missing");
  const topics = { prefix: config.discoveryPrefix, install };
  const availability = availabilityTopic(install);
  const providers: Provider[] = [];
  const handlers = new Map<string, (payload: Buffer) => void>();
  const sent = new Map<string, string>();
  const timers = new Map<number, { key: string; cancel(): void }>();
  let dirty = false;
  let replay = false;
  let running: Promise<void> | undefined;
  let stopped = false;
  let outage = false;
  let stopping: Promise<void> | undefined;

  const client: MqttClient = connect(config.url, {
    clientId: `tare-${install}`,
    clean: true,
    resubscribe: false,
    username: config.username,
    password: config.password,
    will: { topic: availability, payload: "offline", qos: 1, retain: true },
    ...clientOptions,
  });
  const markOffline = () => {
    if (outage || stopped) return;
    outage = true;
    log("mqtt_offline");
  };
  client.on("connect", () => {
    outage = false;
    client.subscribe([config.statusTopic, ...handlers.keys()], { qos: 1 });
    refreshAll(true);
  });
  client.on("close", markOffline);
  client.on("error", markOffline);
  client.on("message", (topic, payload) => {
    if (topic === config.statusTopic) {
      if (payload.toString() === "online") refreshAll(true);
    } else handlers.get(topic)?.(payload);
  });

  function refreshAll(replayRequested = false) {
    if (stopped) return;
    dirty = true;
    if (replayRequested) replay = true;
    drain();
  }

  function drain() {
    if (running || stopped) return;
    running = (async () => {
      while (dirty && !stopped) {
        dirty = false;
        try {
          await reconcile();
        } catch (error) {
          if (!stopped && client.connected)
            log("home_assistant_publish_failed", errorName(error));
        }
      }
    })().finally(() => {
      running = undefined;
      if (dirty) drain();
    });
  }

  function armTimers(people: Person[], now: Date) {
    const present = new Set(people.map((person) => person.id));
    for (const [id, timer] of timers)
      if (!present.has(id)) {
        timer.cancel();
        timers.delete(id);
      }
    for (const person of people) {
      const day = localDay(
        now.toISOString(),
        person.timezone,
        person.day_start_hour,
      );
      const key = `${day}|${person.timezone}|${person.day_start_hour}`;
      if (timers.get(person.id)?.key === key) continue;
      timers.get(person.id)?.cancel();
      const { end } = personDayBounds(
        day,
        person.timezone,
        person.day_start_hour,
      );
      const timer = clock.schedule(
        () => {
          timers.delete(person.id);
          refreshAll();
        },
        Math.max(0, end.getTime() - now.getTime()),
      );
      timers.set(person.id, { key, cancel: timer.cancel });
    }
  }

  async function send(topic: string, payload: string) {
    if (stopped || !client.connected) throw new Error("mqtt_disconnected");
    await client.publishAsync(topic, payload, { qos: 1, retain: true });
    sent.set(topic, payload);
  }

  async function reconcile() {
    const people = listPeople(database);
    armTimers(people, clock.now());
    if (!client.connected) return;
    if (replay) {
      replay = false;
      sent.clear();
    }
    const slugs = entitySlugs(people);
    const configs: { userId: number; topic: string; payload: string }[] = [];
    const states: typeof configs = [];
    for (const person of people) {
      const state = stateTopic(install, person.id);
      for (const provider of providers) {
        const output = provider(person, { state });
        for (const entity of output.entities)
          configs.push({
            userId: person.id,
            ...discoveryMessage(
              topics,
              person,
              slugs.get(person.id) ?? String(person.id),
              entity,
            ),
          });
        for (const [topic, payload] of Object.entries(output.state))
          states.push({ userId: person.id, topic, payload });
      }
    }
    const desired = [...configs, ...states];
    const wanted = new Set(desired.map((message) => message.topic));
    const owned = listHaEntities(database);
    const ownedTopics = new Set(owned.map((row) => row.topic));
    for (const message of desired)
      if (!ownedTopics.has(message.topic))
        insertHaEntity(database, {
          user_id: message.userId,
          topic: message.topic,
        });
    if (sent.get(availability) !== "online") await send(availability, "online");
    for (const message of desired)
      if (sent.get(message.topic) !== message.payload)
        await send(message.topic, message.payload);
    for (const row of owned) {
      if (wanted.has(row.topic)) continue;
      await send(row.topic, "");
      if (stopped) return;
      deleteHaEntity(database, row);
      sent.delete(row.topic);
    }
  }

  return {
    refreshAll: () => refreshAll(),
    addProvider(provider: Provider) {
      providers.push(provider);
      refreshAll();
    },
    subscribe(topic: string, handler: (payload: Buffer) => void) {
      handlers.set(topic, handler);
      if (client.connected) client.subscribe(topic, { qos: 1 });
    },
    stop() {
      stopping ??= (async () => {
        stopped = true;
        for (const timer of timers.values()) timer.cancel();
        timers.clear();
        let confirmed = false;
        if (client.connected) {
          let expiry: { cancel(): void } | undefined;
          confirmed = await Promise.race([
            client
              .publishAsync(availability, "offline", { qos: 1, retain: true })
              .then(
                () => true,
                () => false,
              ),
            new Promise<boolean>((resolve) => {
              expiry = clock.schedule(() => resolve(false), graceMs);
            }),
            new Promise<boolean>((resolve) =>
              client.once("close", () => resolve(false)),
            ),
          ]);
          expiry?.cancel();
        }
        // A forced close sends no DISCONNECT, so the broker can still fire the will.
        if (confirmed) await client.endAsync();
        else {
          log("mqtt_offline_unconfirmed");
          await client.endAsync(true);
        }
      })();
      return stopping;
    },
  };
}
