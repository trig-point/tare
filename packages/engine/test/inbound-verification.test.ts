import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import type { TestContext } from "node:test";
import { dkimSign } from "mailauth/lib/dkim/sign";
import { dkimVerify } from "mailauth/lib/dkim/verify";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import type { InboundOptions } from "../src/inbound/endpoint.ts";
import { createOrderEmailParseJob } from "../src/inbound/job.ts";
import { markMessage, selectMessage } from "../src/inbound/message.ts";
import { createJobRunner } from "../src/jobs.ts";
import { accessConfig, dummyHash, issuedAt, keySet } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const services = {
  kit: {
    senders: ["orders@kit.example.com"],
    dkim_domains: ["kit.example.com"],
  },
};
const clock = { now: () => issuedAt };
const keys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "der" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const resolver = async () => [
  [`v=DKIM1; k=rsa; p=${keys.publicKey.toString("base64")}`],
];
const message = (id = "order", from = "orders@kit.example.com", extra = "") =>
  Buffer.from(
    `From: ${from}\r\nSubject: Meal delivery\r\n${id ? `Message-ID: <${id}@example.com>\r\n` : ""}${extra}Content-Type: text/plain\r\n\r\nFrom: orders@kit.example.com\r\nGarden Bowl 2\r\n`,
  );
const attached = (original: Buffer, count = 1) =>
  Buffer.from(
    `From: person@example.com\r\nSubject: Forward\r\nContent-Type: multipart/mixed; boundary=parts\r\n\r\n--parts\r\nContent-Type: text/plain\r\n\r\nWrapper body\r\n${`--parts\r\nContent-Type: message/rfc822\r\nContent-Disposition: attachment\r\nContent-Transfer-Encoding: base64\r\n\r\n${original.toString("base64")}\r\n`.repeat(count)}--parts--\r\n`,
  );
async function signed(raw: Buffer, domain = "kit.example.com") {
  const result = await dkimSign(raw, {
    signatureData: [
      {
        signingDomain: domain,
        selector: "fixture",
        privateKey: keys.privateKey,
      },
    ],
  });
  assert.deepEqual(result.errors, []);
  return Buffer.concat([Buffer.from(result.signatures), raw]);
}
async function setupInbound(
  context: TestContext,
  options: InboundOptions = {},
  mode: "access" | "fallback" = "fallback",
) {
  const setup = await twoUsers(context, mode);
  const config = {
    ...(mode === "access"
      ? accessConfig
      : loadConfig({ DATABASE_URL: ":memory:" })),
    orderEmailServices: services,
  };
  const app = createApp({
    database: setup.database,
    config,
    clock,
    dummyHash,
    verifyPassword: async () => false,
    accessKeySet: keySet,
    dkimResolver: async () => {
      assert.equal(setup.database.inTransaction, false);
      return resolver();
    },
    ...options,
  });
  const { token } = await (
    await setup.admin.request("/api/inbound-token", {
      method: "POST",
      body: "{}",
    })
  ).json();
  const post = (raw: Buffer) =>
    app.request("/api/inbound/email", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: raw,
    });
  const rows = () =>
    setup.database
      .prepare("SELECT * FROM inbound_emails ORDER BY id")
      .all() as Record<string, unknown>[];
  return { ...setup, app, post, rows };
}

test("DKIM fixture table requires exact pass, a domain boundary and one matching sender", async (context) => {
  context.mock.method(globalThis, "fetch", () =>
    assert.fail("Email content fetched"),
  );
  const original = await signed(message());
  const changed = Buffer.from(
    original.toString().replace("Garden Bowl 2", "Garden Bowl 3"),
  );
  assert.equal(
    (await dkimVerify(changed, { resolver })).results[0]?.status.result,
    "neutral",
  );
  const cases = [
    [original, "verified"],
    [await signed(message(), "mail.kit.example.com"), "verified"],
    [await signed(message(), "notkit.example.com"), "sender_matched"],
    [await signed(message(), "other.example.com"), "sender_matched"],
    [attached(original), "verified"],
    [attached(changed), "sender_matched"],
    [changed, "sender_matched"],
    [message("inline", "person@example.com"), "unverified"],
    [
      message(
        "forged",
        "person@example.com",
        "Authentication-Results: example.com; dkim=pass\r\nSender: orders@kit.example.com\r\nReply-To: orders@kit.example.com\r\nReturn-Path: orders@kit.example.com\r\nReceived: from kit.example.com\r\n",
      ),
      "unverified",
    ],
    [attached(original, 2), "unverified"],
    [
      message("multiple", "orders@kit.example.com, person@example.com"),
      "unverified",
    ],
  ] as const;
  for (const [raw, mark] of cases)
    assert.deepEqual(
      await markMessage(await selectMessage(raw), services, resolver),
      { mark, service: mark === "unverified" ? null : "kit" },
    );
  const logs = context.mock.method(console, "info", () => undefined);
  const setup = await setupInbound(context);
  for (const raw of [original, message("inline", "person@example.com")]) {
    const response = await setup.post(raw);
    assert.equal(response.status, 202);
    const result = await response.json();
    assert.deepEqual(logs.mock.calls.at(-1)?.arguments, [
      "inbound_email_marked",
      result.email_id,
      result.mark,
    ]);
  }
  assert.deepEqual(
    setup.rows().map((row) => [row.mark, row.parse_state]),
    [
      ["verified", "queued"],
      ["unverified", "held"],
    ],
  );
});

test("mounted credential boundary, marking failures and concurrent duplicates retain one subject", async (context) => {
  for (const mode of ["access", "fallback"] as const) {
    let marks = 0;
    let kicks = 0;
    const setup = await setupInbound(
      context,
      {
        markEmail: async (...parameters) => {
          if (++marks === 1) throw new Error("Private content");
          return markMessage(...parameters);
        },
        onEmailQueued: () => kicks++,
      },
      mode,
    );
    for (const [id, wrapped] of [
      ["failed-id", false],
      ["", true],
    ] as const) {
      marks = 0;
      setup.database.exec("DELETE FROM questions; DELETE FROM inbound_emails");
      const raw = message(id);
      const response = await setup.post(wrapped ? attached(raw) : raw);
      assert.equal(response.status, 202);
      const first = await response.json();
      assert.deepEqual(
        await (await setup.post(wrapped ? raw : attached(raw))).json(),
        { email_id: first.email_id, duplicate: true },
      );
      assert.deepEqual([marks, kicks, setup.rows().length], [1, 0, 1]);
      assert.equal(setup.rows()[0]?.reason_class, "Error");
      assert.equal(
        setup.database.prepare("SELECT id FROM questions").all().length,
        1,
      );
    }
    marks = 1;
    const responses = await Promise.all([
      setup.post(message("race")),
      setup.post(message("race")),
    ]);
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 202],
    );
    assert.equal(
      (await responses[0].json()).email_id,
      (await responses[1].json()).email_id,
    );
    assert.equal(kicks, 1);
  }
});

test("the parse drain persists results and advances past a thrown row with a failed run", async (context) => {
  const setup = await setupInbound(context);
  const job = createOrderEmailParseJob({
    database: setup.database,
    clock,
    model: null,
  });
  await setup.post(message());
  assert.equal(job.schedule, "*/5 * * * *");
  assert.equal(
    await job.run({ signal: new AbortController().signal }),
    "emails_parsed:1",
  );
  assert.equal(setup.rows()[0]?.parse_state, "no_model");
  setup.database.exec("DELETE FROM inbound_emails");
  for (const id of ["first", "middle", "last"])
    await setup.post(attached(message(id)));
  setup.database
    .prepare("UPDATE inbound_emails SET raw = ? WHERE dedupe_key = ?")
    .run(Buffer.from("broken"), "mid:<middle@example.com>");
  let calls = 0;
  const empty = { value: null, excerpt: null, uncertain: false };
  const model = {
    baseURL: "https://model.example.com/v1",
    apiKey: "fixture",
    model: "fixture",
    fetch: (async (_input, init) => {
      calls++;
      assert.ok(!String(init?.body).includes("Wrapper body"));
      assert.ok(String(init?.body).includes("2026-01-01"));
      return Response.json({
        id: "fixture",
        object: "chat.completion",
        created: 0,
        model: "fixture",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({
                service: empty,
                delivery_date: empty,
                kind: empty,
                meals: [],
              }),
            },
          },
        ],
      });
    }) as typeof fetch,
  };
  const logs = context.mock.method(console, "error", () => undefined);
  const runner = createJobRunner({
    database: setup.database,
    clock,
    timezone: "UTC",
    report: () => undefined,
  });
  runner.register(
    createOrderEmailParseJob({ database: setup.database, clock, model }),
  );
  runner.start();
  context.after(() => runner.stop());
  assert.equal((await runner.runNow(job.name)).status, "failed");
  assert.deepEqual(
    setup.rows().map((row) => row.parse_state),
    ["parsed", "failed", "parsed"],
  );
  assert.equal(setup.rows()[1]?.reason_class, "Error");
  assert.equal(calls, 2);
  assert.ok(
    logs.mock.calls.some(
      (call) => call.arguments[0] === "emails_parsed:2 failed:1",
    ),
  );
  assert.deepEqual(
    setup.database.prepare("SELECT status, detail FROM job_runs").get(),
    { status: "failed", detail: "job_failed" },
  );
});

test("email service config table validates reset, normalization and overlaps", () => {
  const cases: [string | undefined, typeof services | null | object][] = [
    [undefined, {}],
    ["", {}],
    [" ", {}],
    [
      JSON.stringify({
        kit: {
          senders: ["ORDERS@KIT.EXAMPLE.COM"],
          dkim_domains: ["KIT.EXAMPLE.COM"],
        },
      }),
      services,
    ],
    ["{", null],
    ["[]", null],
  ];
  for (const service of [
    { senders: [], dkim_domains: [] },
    { senders: ["bad address"], dkim_domains: [] },
    { senders: [], dkim_domains: ["https://kit.example.com"] },
  ])
    cases.push([JSON.stringify({ kit: service }), null]);
  for (const other of [
    { senders: [], dkim_domains: ["kit.example.com"] },
    { senders: [], dkim_domains: ["mail.kit.example.com"] },
    { senders: [], dkim_domains: ["example.com"] },
    { senders: ["ORDERS@KIT.EXAMPLE.COM"], dkim_domains: [] },
  ])
    cases.push([JSON.stringify({ ...services, other }), null]);
  for (const [value, expected] of cases) {
    const read = () =>
      loadConfig({ DATABASE_URL: ":memory:", TARE_ORDER_EMAIL_SERVICES: value })
        .orderEmailServices;
    if (expected === null) assert.throws(read, /TARE_ORDER_EMAIL_SERVICES/);
    else assert.deepEqual(read(), expected);
  }
});
