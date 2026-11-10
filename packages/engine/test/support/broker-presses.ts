import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { connectAsync } from "mqtt";

type Harness = {
  port: number;
  published: string[];
  status: string;
  statusTopic: string;
  clock: { now(): Date };
  retained(): Promise<Map<string, string>>;
};

/** A Home Assistant stand-in that presses buttons and waits for the publisher to catch up. */
export async function brokerPresses(
  context: TestContext,
  harness: Harness,
  topic: string,
  resultTopic: string,
) {
  const client = await connectAsync(`mqtt://127.0.0.1:${harness.port}`);
  context.after(() => client.endAsync());
  // A status "online" replay opens with the availability publish once the running reconcile is
  // done, so the second replay starts only after the first has picked up every earlier change.
  const replayed = async () => {
    const mark = harness.published.length;
    await client.publishAsync(harness.statusTopic, "online", { qos: 1 });
    while (!harness.published.slice(mark).includes(`${harness.status} online`))
      await setImmediate();
  };
  const flushed = async () => {
    await replayed();
    await replayed();
  };
  const press = async (payload: string, expected: string) => {
    const result = async () => (await harness.retained()).get(resultTopic);
    const before = await result();
    // A new press time makes every result payload differ, so a wrong result is asserted, not waited on.
    harness.clock.now().setTime(harness.clock.now().getTime() + 1000);
    await client.publishAsync(topic, payload, { qos: 1 });
    while ((await result()) === before) await setImmediate();
    assert.equal(JSON.parse((await result()) ?? "{}").result, expected);
    await flushed();
  };
  return { flushed, press };
}
