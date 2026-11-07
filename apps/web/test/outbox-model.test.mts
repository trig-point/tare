import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { readSessionOutcome } from "../src/outbox-http.ts";
import type { QueueEntry } from "../src/outbox-store.ts";
import { fixture, json, other, person, session } from "./outbox-support.mts";
import { test } from "./support.mts";

const replies: [number, string, string?][] = [
  [201, "ack"],
  [200, "duplicate"],
  [400, "reject", "invalid_request"],
  [422, "reject", "invalid_entry"],
  [503, "retry"],
  [503, "retry", "html"],
  [429, "retry"],
  [408, "retry"],
  ...[301, 302, 303, 307, 308, 401].map((status): [number, string] => [
    status,
    "sign_in_needed",
  ]),
  [200, "sign_in_needed", "html"],
  [200, "sign_in_needed", "malformed"],
  [200, "retry", "wrong_ack"],
  [409, "retry", "person_mismatch"],
  [403, "retry", "not_a_member"],
];
async function trace(context: TestContext, actions: string[]) {
  const { store, open, replay, scheduler } = await fixture(context);
  let model: QueueEntry[] = [];
  let active = person;
  let online = true;
  let signedOut = false;
  let response: (typeof replies)[number] = [201, "ack"];
  let failures = 0;
  let delay: number[] = [];
  const sent: string[] = [];
  const instance = replay({
    online: () => online,
    readSession: undefined,
    fetch: async (path, options) => {
      if (path === "/api/session")
        return signedOut
          ? new Response('{"error":{"code":"unauthenticated"}}', {
              status: 401,
              headers: {
                "Content-Type": "application/json",
                "X-Tare-Auth-Mode": "fallback",
              },
            })
          : json(session(active));
      const body = JSON.parse(String(options?.body));
      assert.equal(
        new Headers(options?.headers).get("X-Tare-Person"),
        String(active.id),
      );
      assert.equal(options?.redirect, "manual");
      sent.push(body.client_id);
      const [status, outcome, code] = response;
      const entry = { ...body, user_id: code === "wrong_ack" ? -1 : active.id };
      if (code === "html" || code === "malformed")
        return new Response(code === "html" ? "<html>" : "{", {
          status,
          headers: {
            "Content-Type": code === "html" ? "text/html" : "application/json",
          },
        });
      return json(
        outcome === "ack" || outcome === "duplicate" || code === "wrong_ack"
          ? { created: outcome === "ack", entry }
          : { error: { code } },
        status,
      );
    },
  });
  await instance.start();
  for (const action of actions) {
    const first = model[0];
    if (action === "enqueue") {
      const kind = model.length % 2 ? "weight" : "intake";
      const row = await store.enqueue(kind, { note: "Optional" }, active);
      model.push(structuredClone(row));
      assert.equal(
        row.body[kind === "intake" ? "eaten_at" : "measured_at"],
        "2026-01-01T06:00:00.000Z",
      );
    } else if (action === "person") {
      active = active.id === 1 ? other : person;
      signedOut = false;
    } else if (action === "offline") online = !online;
    else if (action === "signed_out") signedOut = true;
    else if (action === "bump") await store.bumpSession();
    else if (action === "reload")
      assert.deepEqual(await (await open()).entries(), model);
    else if (["edit", "resend", "discard"].includes(action)) {
      if (first) {
        const editable =
          first.state === "rejected" && first.error_code !== "already_saved";
        const changed =
          action === "edit"
            ? await store.edit(first, { note: undefined, value: 200 })
            : await (action === "resend"
                ? store.resend(first)
                : store.discard(first));
        assert.equal(changed, action === "discard" || editable);
        if (action === "discard") model.shift();
        else if (editable) {
          if (action === "edit") {
            delete first.body.note;
            first.body.value = 200;
            first.revision++;
          }
          first.state = "pending";
          delete first.error_code;
          delete first.server_row;
        }
      }
    } else {
      const selected = replies[Number(action)];
      assert.ok(selected);
      response = selected;
      const expectedSends: string[] = [];
      const pending = model.some((row) => row.state === "pending");
      let stopped = false;
      const [status, outcome, code] = response;
      if (online && !signedOut)
        model = model.flatMap((row) => {
          if (stopped || row.person_id !== active.id || row.state !== "pending")
            return [row];
          expectedSends.push(row.client_id);
          if (
            outcome === "ack" ||
            (outcome === "duplicate" && row.revision === 0)
          )
            return [];
          if (outcome !== "reject" && outcome !== "duplicate") {
            stopped = true;
            return [row];
          }
          row.state = "rejected";
          row.error_code =
            outcome === "duplicate"
              ? "already_saved"
              : (code ?? `http_${status}`);
          if (outcome === "duplicate")
            row.server_row = { ...row.body, user_id: active.id };
          return [row];
        });
      if (!pending || online) {
        if (stopped && outcome === "retry")
          delay = [Math.min(30_000 * 2 ** failures++, 900_000)];
        else {
          delay = [];
          failures = 0;
        }
      }
      sent.length = 0;
      await instance.wake();
      assert.deepEqual(sent, expectedSends);
    }
    assert.deepEqual(await store.entries(), model, JSON.stringify(actions));
    assert.deepEqual(scheduler.delays(), delay, JSON.stringify(actions));
  }
  await instance.close();
  store.close();
}

test("independent oracle covers bounded response sequences, two people, retry/reset, edit, resend, discard and reload", async (context) => {
  const started = performance.now();
  const alphabet = "enqueue person bump edit resend discard 0 2".split(" ");
  for (const first of alphabet)
    for (const second of alphabet)
      for (const third of alphabet)
        await trace(context, ["enqueue", first, second, third]);
  for (const response of replies.keys())
    await trace(
      context,
      `enqueue enqueue ${response} edit 1 reload resend discard`.split(" "),
    );
  await trace(
    context,
    "enqueue 4 4 4 4 4 4 4 offline 0 reload offline 0 person enqueue person 0 person signed_out 0 person 0".split(
      " ",
    ),
  );
  for (const initialSeed of [1, 29, 232, 65537]) {
    let seed = initialSeed;
    const choices = [
      ...alphabet,
      ...[...replies.keys()].map(String),
      "offline",
      "reload",
      "signed_out",
    ];
    const actions = Array.from({ length: 100 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const action = choices[seed % choices.length];
      assert.ok(action);
      return action;
    });
    try {
      await trace(context, actions);
    } catch (error) {
      throw new Error(
        `Replay seed ${initialSeed}: ${JSON.stringify(actions)}`,
        { cause: error },
      );
    }
  }
  assert.equal(
    (await readSessionOutcome({ online: () => false })).type,
    "offline",
  );
  for (const [response, expected] of [
    [json({}), "sign_in_needed"],
    [new Response("<html>"), "sign_in_needed"],
    [new Response(null, { status: 302 }), "sign_in_needed"],
    [new Response(null, { status: 401 }), "sign_in_needed"],
    [new Response(null, { status: 403 }), "sign_in_needed"],
    [new Response(null, { status: 503 }), "retry"],
    [Response.error(), "retry"],
  ] as const)
    assert.equal(
      (await readSessionOutcome({ fetch: async () => response })).type,
      expected,
    );
  context.diagnostic(
    `Exhaustive bound 3: 512 traces; 4 seeds x 100 actions; ${Math.round(performance.now() - started)} ms; shared hang ceiling 60000 ms`,
  );
});
