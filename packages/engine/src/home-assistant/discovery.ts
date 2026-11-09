import type { ListPeopleResult } from "../queries/home-assistant/list-people.ts";

export type Person = ListPeopleResult;

export interface EntityDefinition {
  component: "sensor" | "button" | "event";
  key: string;
  config: Record<string, unknown>;
}

export interface ProviderOutput {
  entities: EntityDefinition[];
  state: Record<string, string>;
  events?: { topic: string; payload: string; sent(): void }[];
  refreshAt?: Date;
}

export type Provider = (
  person: Person,
  topics: { state: string; events: string },
) => ProviderOutput;

export interface Topics {
  prefix: string;
  install: string;
}

export const deviceKey = (install: string, userId: number) =>
  `tare_${install}_${userId}`;
export const availabilityTopic = (install: string) => `tare/${install}/status`;
export const stateTopic = (install: string, userId: number) =>
  `tare/${install}/${userId}/state`;
export const eventTopic = (install: string, userId: number) =>
  `tare/${install}/${userId}/events`;

export function entitySlugs(people: Person[]): Map<number, string> {
  const base = new Map(
    people.map((person) => [
      person.id,
      person.username
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, ""),
    ]),
  );
  const counts = new Map<string, number>();
  for (const slug of base.values())
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  return new Map(
    [...base].map(([id, slug]) => [
      id,
      !slug ? String(id) : counts.get(slug) === 1 ? slug : `${slug}_${id}`,
    ]),
  );
}

export function discoveryMessage(
  topics: Topics,
  person: Person,
  slug: string,
  entity: EntityDefinition,
): { topic: string; payload: string } {
  const device = deviceKey(topics.install, person.id);
  return {
    topic: `${topics.prefix}/${entity.component}/${device}/${entity.key}/config`,
    payload: JSON.stringify({
      ...entity.config,
      unique_id: `${device}_${entity.key}`,
      default_entity_id: `${entity.component}.tare_${slug}_${entity.key}`,
      availability_topic: availabilityTopic(topics.install),
      device: {
        identifiers: [device],
        name: `Tare ${person.username}`,
        manufacturer: "Tare",
      },
      origin: { name: "Tare" },
    }),
  };
}
