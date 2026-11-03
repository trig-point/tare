import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { Hono } from "hono";
import type { AuthEnv } from "../src/auth/middleware.ts";
import { hashToken } from "../src/auth/sessions.ts";
import { loadConfig } from "../src/config.ts";
import { mountInboundEmail } from "../src/inbound/endpoint.ts";
import { selectMessage } from "../src/inbound/message.ts";
import { heldEmailKind } from "../src/inbound/questions.ts";
import {
  assertionHeader,
  dummyHash,
  issuedAt,
  rejection,
  signAccessToken,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const write = { method: "POST", body: "{}" };
const message = (id = "order") =>
  Buffer.from(
    `From: orders@kit.example.com\r\nSubject: Meal delivery\r\n${id ? `Message-ID: <${id}@example.com>\r\n` : ""}Content-Type: text/plain\r\n\r\nGarden Bowl 2\r\n`,
  );
const wrapped = (originals: Buffer[], encoding = "base64") =>
  Buffer.from(
    `From: person@example.com\r\nSubject: Forward\r\nMessage-ID: <wrapper@example.com>\r\nContent-Type: multipart/mixed; boundary=parts\r\n\r\n--parts\r\nContent-Type: text/plain\r\n\r\nWrapper body\r\n${originals.map((original) => `--parts\r\nContent-Type: message/rfc822\r\nContent-Disposition: attachment\r\nContent-Transfer-Encoding: ${encoding}\r\n\r\n${encoding === "base64" ? original.toString("base64") : original.toString()}\r\n`).join("")}--parts--\r\n`,
  );
async function setupInbound(context: TestContext, mode: "access" | "fallback") {
  const setup = await twoUsers(context, mode);
  const app = new Hono<AuthEnv>();
  mountInboundEmail(app, {
    database: setup.database,
    config: loadConfig({ DATABASE_URL: ":memory:" }),
    clock: { now: () => issuedAt },
    dummyHash,
    verifyPassword: async () => false,
    questionKinds: new Map([[heldEmailKind.name, heldEmailKind]]),
  });
  const create = async (
    request = setup.admin.request,
    path = "/api/inbound-token",
  ) => {
    const response = await request(path, write);
    assert.equal(response.status, 201);
    return (await response.json()).token as string;
  };
  const post = (raw: Buffer, token: string) =>
    app.request("/api/inbound/email", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: raw,
    });
  const rows = (sql: string) => setup.database.prepare(sql).all();
  return { ...setup, create, post, rows };
}

test("browser token management is owner-scoped and the inbound route requires its token", async (context) => {
  for (const mode of ["access", "fallback"] as const) {
    const setup = await setupInbound(context, mode);
    await rejection(
      await setup.admin.request("/api/inbound-token/rotate", write),
      404,
      "token_missing",
    );
    const admin = await setup.create();
    const member = await setup.create(setup.member.request);
    await rejection(
      await setup.admin.request("/api/inbound-token", write),
      409,
      "token_exists",
    );
    assert.deepEqual(
      setup.rows("SELECT token_hash FROM inbound_tokens ORDER BY user_id"),
      [{ token_hash: hashToken(admin) }, { token_hash: hashToken(member) }],
    );
    for (const token of [admin, member])
      assert.equal((await setup.post(message(), token)).status, 202);
    assert.deepEqual(
      setup.rows("SELECT user_id FROM inbound_emails ORDER BY id"),
      [{ user_id: setup.admin.user.id }, { user_id: setup.member.user.id }],
    );
    const rotated = await setup.create(
      setup.admin.request,
      "/api/inbound-token/rotate",
    );
    await rejection(
      await setup.post(message(), admin),
      401,
      "inbound_token_invalid",
    );
    for (const token of [member, rotated])
      assert.equal((await setup.post(message(), token)).status, 200);
    for (const [path, method] of [
      ["/api/me", "GET"],
      ["/api/inbound-token", "POST"],
      ["/api/inbound-token/rotate", "POST"],
    ])
      await rejection(
        await setup.app.request(path as string, {
          method,
          headers: { Authorization: `Bearer ${rotated}` },
          body: method === "POST" ? "{}" : undefined,
        }),
        401,
        "unauthenticated",
      );
    assert.equal(
      (await setup.app.request("/api/inbound/email", { method: "POST" }))
        .status,
      401,
    );
    if (mode === "access") {
      await setup.admin.request("/api/agent-tokens", {
        method: "POST",
        body: JSON.stringify({
          client_id: "fixture-agent",
          user_id: setup.admin.user.id,
          name: "Fixture",
        }),
      });
      const headers = assertionHeader(
        await signAccessToken({ sub: "", common_name: "fixture-agent" }),
      );
      for (const path of ["/api/inbound-token", "/api/inbound-token/rotate"])
        await rejection(
          await setup.app.request(path, {
            method: "POST",
            headers,
            body: "{}",
          }),
          403,
          "forbidden",
        );
    }
  }
});

test("token-before-size, unreadable input, subject dedupe and held questions persist only accepted mail", async (context) => {
  const setup = await setupInbound(context, "fallback");
  const token = await setup.create();
  const huge = Buffer.alloc(5 * 1024 * 1024 + 1);
  for (const bearer of ["", "wrong"])
    await rejection(
      await setup.post(huge, bearer),
      401,
      "inbound_token_invalid",
    );
  await rejection(await setup.post(huge, token), 413, "body_too_large");
  for (const raw of [Buffer.alloc(0), Buffer.from("unreadable")])
    await rejection(await setup.post(raw, token), 422, "unreadable_email");
  assert.deepEqual(setup.rows("SELECT id FROM inbound_emails"), []);
  const log = context.mock.method(console, "info", () => undefined);
  for (const id of ["order", ""]) {
    const raw = message(id);
    const response = await setup.post(raw, token);
    const result = await response.json();
    for (const replay of [raw, wrapped([raw]), wrapped([raw], "7bit")]) {
      const duplicate = await setup.post(replay, token);
      assert.equal(duplicate.status, 200);
      assert.deepEqual(await duplicate.json(), {
        email_id: result.email_id,
        duplicate: true,
      });
    }
    assert.deepEqual(log.mock.calls.at(-1)?.arguments, [
      "inbound_email_marked",
      result.email_id,
      "unverified",
    ]);
  }
  const { questions } = await (
    await setup.admin.request("/api/questions")
  ).json();
  assert.equal(questions.length, 2);
  for (const question of questions) {
    assert.match(
      question.prompt,
      /^unverified: Meal delivery; orders@kit.example.com;/,
    );
    assert.ok(!question.prompt.includes("Garden Bowl"));
    await rejection(
      await setup.admin.request("/api/questions/answer", {
        method: "POST",
        body: JSON.stringify({ id: question.id, answer: { release: true } }),
      }),
      409,
      "held_email_answer_unavailable",
    );
  }
  assert.deepEqual(setup.rows("SELECT status FROM questions"), [
    { status: "open" },
    { status: "open" },
  ]);
  assert.deepEqual(
    (await (await setup.member.request("/api/questions")).json()).questions,
    [],
  );
  const attached = wrapped([message("attached")]);
  assert.equal((await setup.post(attached, token)).status, 202);
  assert.deepEqual(
    setup.database
      .prepare(
        "SELECT raw, subject_attached, parse_state FROM inbound_emails ORDER BY id DESC LIMIT 1",
      )
      .get(),
    { raw: attached, subject_attached: 1, parse_state: "held" },
  );
});

test("held prompts keep sender-controlled subject and address inside their own fields", async (context) => {
  const setup = await setupInbound(context, "fallback");
  const token = await setup.create();
  const address = `${"a".repeat(300)}@kit.example.com`;
  const raw = Buffer.from(
    `From: ${address}\r\nSubject: Meal; billing@kit.example.com‮ delivery\r\nMessage-ID: <hostile@example.com>\r\nContent-Type: text/plain\r\n\r\nGarden Bowl 2\r\n`,
  );
  assert.equal((await setup.post(raw, token)).status, 202);
  const [question] = (
    await (await setup.admin.request("/api/questions")).json()
  ).questions;
  const fields = question.prompt.split("; ");
  assert.equal(fields.length, 3);
  assert.equal(fields[0], "unverified: Meal, billing@kit.example.com delivery");
  assert.equal(fields[1], address.slice(0, 254));
});

test("subject selection reads one original, otherwise the wrapper, without fetching linked content", async (context) => {
  context.mock.method(globalThis, "fetch", () =>
    assert.fail("Content fetched"),
  );
  const raw = message();
  const multiple = wrapped([raw, raw]);
  assert.deepEqual((await selectMessage(multiple)).bytes, multiple);
  const html = Buffer.from(
    raw
      .toString()
      .replace("text/plain", "text/html")
      .replace(
        "Garden Bowl 2",
        '<img src="https://images.example.com/a"><a href="https://links.example.com/a">Meal</a>',
      ),
  );
  const { mail } = await selectMessage(wrapped([html]));
  assert.ok(mail.html);
  assert.match(mail.html, /images.example.com/);
  assert.ok(!mail.html.includes("Wrapper body"));
});
