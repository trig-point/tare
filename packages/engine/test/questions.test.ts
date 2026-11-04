import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as McpTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Database } from "better-sqlite3";
import { z as zod } from "zod";
import { createApp } from "../src/app.ts";
import { scopeDatabase } from "../src/db.ts";
import { insertAgentToken } from "../src/queries/insert-agent-token.ts";
import { createQuestion, type QuestionKind } from "../src/questions/kinds.ts";
import * as auth from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const clock = { now: () => auth.issuedAt };
const input = { kind: "example", subjectRef: "example", prompt: "Confirm?" };
const post = (id: number, answer: unknown = true) => ({
  method: "POST",
  body: JSON.stringify({ id, answer }),
});
function kinds(database: Database) {
  database.exec(
    "CREATE TABLE example_subject (value INTEGER); INSERT INTO example_subject VALUES (0)",
  );
  const kind: QuestionKind = {
    name: "example",
    answer: zod.boolean(),
    apply(scope, _question, answer) {
      const database = scopeDatabase(scope);
      database
        .prepare("UPDATE example_subject SET value = ?")
        .run(Number(answer));
      if (!answer) throw new Error("Example failure");
      return { status: "applied" };
    },
  };
  return new Map([[kind.name, kind]]);
}
const seed = (
  database: Database,
  registry: ReadonlyMap<string, QuestionKind>,
  userId: number | null,
) => createQuestion(database, { ...input, userId }, clock, registry);
const subject = (database: Database) =>
  database.prepare("SELECT value FROM example_subject").get();
const ids = (questions: { id: number }[]) =>
  questions.map((question) => question.id);

test("questions validate, apply and close atomically over HTTP", async (context) => {
  const registry = new Map<string, QuestionKind>();
  const setup = auth.fixture(context, { questionKinds: registry });
  const { database } = setup;
  for (const [name, kind] of kinds(database)) registry.set(name, kind);
  const headers = {
    ...auth.requestedWith,
    Cookie: auth.cookie(await setup.signIn()),
  };
  const list = async () =>
    (await (await setup.app.request("/api/questions", { headers })).json())
      .questions;
  const answer = (id: number, value: unknown = true) =>
    setup.app.request("/api/questions/answer", { ...post(id, value), headers });
  const rows = () => database.prepare("SELECT * FROM questions").all();
  assert.deepEqual(await list(), []);
  const question = seed(database, registry, setup.admin.id);
  assert.deepEqual(ids(await list()), [question.id]);
  assert.equal((await list())[0].answer_schema.type, "boolean");
  const before = rows();
  await auth.rejection(await answer(question.id, "yes"), 400, "invalid_answer");
  assert.deepEqual(rows(), before);
  assert.deepEqual(subject(database), { value: 0 });
  assert.equal((await answer(question.id)).status, 200);
  assert.deepEqual(await list(), []);
  assert.deepEqual(subject(database), { value: 1 });
  await auth.rejection(await answer(question.id), 409, "already_answered");
  await auth.rejection(await answer(999), 404, "not_found");
  const ownerless = seed(database, registry, null);
  const open = rows();
  context.mock.method(console, "error", () => {});
  await auth.rejection(await answer(ownerless.id, false), 500, "internal");
  assert.deepEqual(rows(), open);
  assert.deepEqual(subject(database), { value: 1 });
  const oversized = await answer(ownerless.id, "x".repeat(8192));
  await auth.rejection(oversized, 413, "body_too_large");
  assert.equal((await answer(ownerless.id)).status, 200);
  const unsupported = seed(database, registry, null);
  registry.clear();
  await auth.rejection(await answer(unsupported.id), 409, "kind_not_supported");
});

test("browser and MCP identities isolate owners and ownerless questions", async (context) => {
  const setup = await twoUsers(context, "access");
  const { database } = setup;
  const registry = kinds(database);
  const app = createApp({
    database,
    config: auth.accessConfig,
    clock,
    questionKinds: registry,
    accessKeySet: auth.keySet,
    dummyHash: auth.dummyHash,
    verifyPassword: async () => false,
  });
  const owned = seed(database, registry, setup.admin.user.id);
  const ownerless = seed(database, registry, null);
  for (const [person, visible] of [
    [setup.member, []],
    [setup.admin, [owned.id, ownerless.id]],
  ] as const) {
    const browser = await (await person.request("/api/questions")).json();
    assert.deepEqual(ids(browser.questions), visible);
    if (person === setup.member)
      await auth.rejection(
        await person.request("/api/questions/answer", post(owned.id)),
        404,
        "not_found",
      );
    const clientId = `example-question-${person.user.id}`;
    insertAgentToken(database, {
      client_id: clientId,
      user_id: person.user.id,
      name: "Example",
      created_at: auth.issuedAt.toISOString(),
    });
    const token = await auth.signAccessToken({
      sub: "",
      common_name: clientId,
    });
    const client = new Client({ name: "example", version: "1" });
    const transport = new McpTransport(new URL("http://localhost/mcp"), {
      fetch: async (url, init) => app.request(url.toString(), init),
      requestInit: { headers: auth.assertionHeader(token) },
    });
    context.after(() => client.close());
    await client.connect(transport);
    const call = async (name: string, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as [{ text: string }];
      return result.structuredContent ?? JSON.parse(content[0].text);
    };
    assert.deepEqual(
      ids((await call("list_questions")).questions),
      person === setup.admin ? [owned.id] : [],
    );
    const answer = (id: number) =>
      call("answer_question", { id, answer: true });
    const notFound = { error: { code: "not_found" } };
    assert.deepEqual(await answer(ownerless.id), notFound);
    const answered = await answer(owned.id);
    const expected = { id: owned.id, status: "answered" };
    assert.deepEqual(answered, person === setup.admin ? expected : notFound);
    if (person === setup.admin)
      assert.deepEqual(subject(database), { value: 1 });
    await transport.terminateSession();
  }
});
