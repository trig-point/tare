import assert from "node:assert/strict";
import { countUsers } from "../src/queries/count-users.ts";
import {
  assertionHeader,
  cookie,
  fixture,
  publicUser,
  rejection,
  signAccessToken,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const tokenPath = "/api/agent-tokens";
test("agent mappings resolve only their owner, deny browser operations and revoke immediately", async (context) => {
  const setup = await twoUsers(context, "access");
  const { admin, member } = setup;
  const body = {
    client_id: " Invented-Agent-A ",
    user_id: admin.user.id,
    name: " Agent A ",
  };
  const write = { method: "POST", body: JSON.stringify(body) };
  const agent = async (clientId: string) =>
    assertionHeader(await signAccessToken({ sub: "", common_name: clientId }));
  const headers = await agent(" Invented-Agent-A ");
  const service = (path: string, method = "GET", credentials = headers) =>
    setup.app.request(path, { method, headers: credentials });
  const create = (value: unknown) =>
    admin.request(tokenPath, { method: "POST", body: JSON.stringify(value) });
  const list = async (person = admin) => {
    const response = await person.request(tokenPath);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    return (await response.json()).agent_tokens;
  };
  await rejection(await service("/api/me"), 403, "unknown_agent");
  assert.deepEqual(await list(), []);
  const created = await create(body);
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("Cache-Control"), "no-store");
  const { agent_token: mapping } = await created.json();
  assert.deepEqual(mapping, {
    id: 1,
    user_id: admin.user.id,
    client_id: "Invented-Agent-A",
    name: "Agent A",
    created_at: "2026-01-01T00:00:00.000Z",
    last_used_at: null,
  });
  const other = await create({
    ...body,
    client_id: "Invented-Agent-B",
    user_id: member.user.id,
  });
  assert.equal(other.status, 201);
  const duplicate = await create({ ...body, user_id: member.user.id });
  await rejection(duplicate, 409, "client_id_taken");
  assert.deepEqual(await list(), [mapping]);
  await rejection(await member.request(tokenPath, write), 403, "forbidden");
  const remove = (person = admin) =>
    person.request(`${tokenPath}/${mapping.id}`, { method: "DELETE" });
  await rejection(await remove(member), 404, "not_found");
  assert.deepEqual(
    (await list(member)).map((row: { user_id: number }) => row.user_id),
    [member.user.id],
  );
  setup.setNow("2026-01-01T00:00:10.000Z");
  const identity = await service("/api/me");
  assert.equal(identity.status, 200);
  assert.deepEqual(await publicUser(identity), admin.user);
  assert.equal((await list())[0].last_used_at, "2026-01-01T00:00:10.000Z");
  assert.equal((await list(member))[0].last_used_at, null);
  for (const [path, method] of [
    ["/api/users", "POST"],
    [tokenPath, "POST"],
    [tokenPath, "GET"],
    ["/api/session", "GET"],
    ["/missing", "GET"],
    ["/api/me", "POST"],
    [`/api/agent-tokens/${mapping.id}`, "DELETE"],
  ] as const) {
    await context.test(`service denied ${method} ${path}`, async () => {
      const denied = await service(path, method);
      await rejection(denied, 403, "forbidden", path !== "/missing");
      assert.equal((await list()).length, 1);
      assert.deepEqual(countUsers(setup.database), { count: 2 });
    });
  }
  setup.setNow("2026-01-01T00:00:20.000Z");
  const memberAgent = await agent("Invented-Agent-B");
  const asMember = await service("/api/me", "GET", memberAgent);
  assert.deepEqual(await publicUser(asMember), member.user);
  const usedAt = async (person = admin) => (await list(person))[0].last_used_at;
  assert.equal(await usedAt(), "2026-01-01T00:00:10.000Z");
  assert.equal(await usedAt(member), "2026-01-01T00:00:20.000Z");
  const deleted = await remove();
  assert.equal(deleted.status, 204);
  assert.equal(deleted.headers.get("Cache-Control"), "no-store");
  await rejection(await service("/api/me"), 403, "unknown_agent");
  await rejection(await remove(), 404, "not_found");
  assert.deepEqual(await list(), []);
  const post = (body: string) =>
    admin.request(tokenPath, { method: "POST", body });
  for (const invalid of [
    "{",
    "null",
    "[]",
    "{}",
    JSON.stringify({ ...body, client_id: " " }),
    JSON.stringify({ ...body, client_id: "x".repeat(257) }),
    JSON.stringify({ ...body, name: " " }),
    JSON.stringify({ ...body, name: "x".repeat(65) }),
    JSON.stringify({ ...body, user_id: "1" }),
    JSON.stringify({ ...body, user_id: 999 }),
  ])
    await rejection(await post(invalid), 400, "invalid_request");
  const browserHeaders = assertionHeader(await signAccessToken());
  for (const [path, method] of [
    [tokenPath, "POST"],
    [`${tokenPath}/1`, "DELETE"],
  ] as const)
    await rejection(
      await setup.app.request(path, {
        method,
        headers: browserHeaders,
        body: JSON.stringify(body),
      }),
      403,
      "requested_with_required",
    );
  for (const id of ["missing", "999"])
    await rejection(
      await admin.request(`${tokenPath}/${id}`, { method: "DELETE" }),
      404,
      "not_found",
    );
  assert.deepEqual(await list(), []);
  for (const path of ["/api/me", tokenPath, `${tokenPath}/1`])
    await rejection(await setup.app.request(path), 401, "unauthenticated");
  const fallback = fixture(context);
  for (const [path, method] of [
    [tokenPath, "GET"],
    [tokenPath, "POST"],
    [`${tokenPath}/1`, "DELETE"],
  ] as const)
    await rejection(
      await fallback.app.request(path, { method }),
      404,
      "not_found",
    );
  const fallbackIdentity = await fallback.app.request("/api/me", {
    headers: { Cookie: cookie(await fallback.signIn()) },
  });
  assert.equal(fallbackIdentity.status, 200);
  assert.equal((await publicUser(fallbackIdentity)).id, fallback.admin.id);
});
